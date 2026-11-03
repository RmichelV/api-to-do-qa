# Database setup (local and Hostinger)

Engine: **MySQL 8.0+ or MariaDB 10.4+** (D1). The schema avoids engine-specific
features so it runs on both. Driver: `mysql2` (the only new dependency).

## 1. Local engine

Local development uses **Docker** (`docker-compose.dev.yml`, MariaDB 10.11 on
`127.0.0.1:3307`). It is only for development: production points `DB_*` at the
Hostinger database, and nothing in the app depends on Docker.

### 1.1 Required `.env` values

Docker reads the project `.env` (git-ignored) for its secrets:

```ini
MARIADB_ROOT_PASSWORD=<long random value>   # root of the local container
DB_PASSWORD=<qa_app password>               # also used by the app
MIGRATE_DB_USER=qa_migrator
MIGRATE_DB_PASSWORD=<qa_migrator password>
DB_PORT=3307
TEST_DB_HOST=127.0.0.1
TEST_DB_PORT=3307
TEST_DB_NAME=api_to_do_qa_test
TEST_DB_USER=qa_migrator
TEST_DB_PASSWORD=<same as MIGRATE_DB_PASSWORD>
```

### 1.2 Daily commands

```bash
docker compose -f docker-compose.dev.yml up -d     # start (first start creates databases and users)
docker compose -f docker-compose.dev.yml ps        # status: "healthy" means ready
docker compose -f docker-compose.dev.yml logs -f db # follow the database logs
docker compose -f docker-compose.dev.yml stop      # stop, keeping the data
```

### 1.3 Reset from scratch

```bash
docker compose -f docker-compose.dev.yml down -v   # deletes the container AND all its data
docker compose -f docker-compose.dev.yml up -d     # recreates databases and users
npm run migrate               # recreates the tables
```

The init script (`db/docker/init/01-databases-and-users.sh`) runs only when
the data volume is empty, so changing a password in `.env` later requires a
reset. To remove Docker entirely: `docker compose -f docker-compose.dev.yml down -v`,
then delete `docker-compose.dev.yml` and `db/docker/`.

`docker-compose.yml` (without `.dev`) is the **production** stack (MariaDB +
app + Caddy, from `master`); do not use it for local development — only on
the server (§7).

XAMPP MariaDB 10.4 (port 3306) is no longer used by this project.

## 2. Databases

Create two empty databases (no tables yet; migrations come in T3):

```sql
CREATE DATABASE api_to_do_qa
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE api_to_do_qa_test
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- `api_to_do_qa` — development.
- `api_to_do_qa_test` — automated tests (truncated by the tests).

## 3. Users

Separate users for runtime and migrations (design §5.6). Example for local
MariaDB/MySQL (run as root):

```sql
-- runtime user: DML only
CREATE USER 'qa_app'@'localhost' IDENTIFIED BY 'your-local-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON api_to_do_qa.* TO 'qa_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON api_to_do_qa_test.* TO 'qa_app'@'localhost';

-- migration user: also DDL (used by `npm run migrate`, see §6)
CREATE USER 'qa_migrator'@'localhost' IDENTIFIED BY 'another-local-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES
  ON api_to_do_qa.* TO 'qa_migrator'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES
  ON api_to_do_qa_test.* TO 'qa_migrator'@'localhost';
```

`DROP` is only on the **test** database: the integration tests drop and
re-create the auth tables there. The migrator never drops anything on the
development database, and on Hostinger it does not receive `DROP` at all —
migrations only create.

With Docker (§1) these users are created automatically on the first start,
with host `'%'` (connections arrive from the Docker network) and the passwords
from `.env`. The SQL above is the reference for any other MySQL/MariaDB.

On Hostinger create the same two users from hPanel → Databases. The app user
gets only `SELECT, INSERT, UPDATE, DELETE`.

## 4. Environment variables

Local: copy the template below to `.env` in the project root. `.env` is
git-ignored; only `.env.example` is committed. Loading uses Node 22's
`process.loadEnvFile()` (no dotenv dependency) and happens in
`src/config/env.js`, which validates every variable at startup.

```ini
NODE_ENV=development
PORT=4000
APP_ORIGIN=http://localhost:4000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=api_to_do_qa
DB_USER=qa_app
DB_PASSWORD=your-local-password
DB_SSL=false
DB_CONNECTION_LIMIT=5
SESSION_DAYS=7
TRUST_PROXY=0
```

Production: set the same variables in the Hostinger panel (values from
hPanel → Databases); no `.env` file on the server. `DB_SSL=true` only when the
database is reached over a network.

## 5. Verify the connection

```bash
npm test                 # includes test/db.test.js
```

`test/db.test.js`, `test/migrate.test.js`, `test/userRepository.test.js`,
`test/create-admin.test.js` and `test/reset-password.test.js` are integration
tests and read **only `TEST_DB_*`**,
never `DB_*`: they drop/truncate data, so they must never touch the
development database. Without `TEST_DB_*` they skip themselves (14 pass,
11 skipped), and `npm test` stays green. Files run sequentially
(`--test-concurrency=1`) because they share one test database.

To enable them, point them at the **test** database. From T3 on, the
integration tests run the migrations, so `TEST_DB_USER` needs DDL rights on
the test database — use `qa_migrator` (§3):

```bash
# PowerShell
$env:TEST_DB_HOST='127.0.0.1'; $env:TEST_DB_PORT='3306'
$env:TEST_DB_NAME='api_to_do_qa_test'; $env:TEST_DB_USER='qa_migrator'
$env:TEST_DB_PASSWORD='another-local-password'
npm test                 # 25 pass, 0 skip
```

Or one-off from Node (uses the `DB_*` from `.env` via `loadConfig()`):

```bash
node -e "import('./src/db/pool.js').then(async m => { const pool = m.createPool(); const [[row]] = await pool.query('SELECT 1 AS ok'); console.log(row); await pool.end(); })"
```

(with the env vars set, e.g. via a local `.env`).

## 6. Migrations (`npm run migrate`)

From T3 on, the schema lives in numbered files under `db/migrations/`:

| File | Content |
|---|---|
| `001_create_users.sql` | `users` (design §4.1) |
| `002_create_user_sessions.sql` | `user_sessions` (§4.2) |
| `003_create_login_attempts.sql` | `login_attempts` (§4.3) |

`scripts/migrate.js` applies the pending files in order on its own connection
(`multipleStatements: true`; the application pool keeps it `false`), records
each version in `schema_migrations` only after the file succeeds, and stops at
the first error (§4.4). Running it twice is a no-op.

```bash
npm run migrate
```

Credentials: uses `DB_*` by default. Set `MIGRATE_DB_USER` and
`MIGRATE_DB_PASSWORD` to run as the migration user — required on Hostinger,
where the app user has no DDL (§5.6):

```ini
MIGRATE_DB_USER=qa_migrator
MIGRATE_DB_PASSWORD=another-local-password
```

## 7. Production deployment (Hostinger VPS, `docker-compose.yml`, design §8.2)

The production stack runs **MariaDB 10.11, the app and Caddy on the server**.
Caddy terminates TLS for the domain and proxies to the app with
`X-Forwarded-Proto`, so `TRUST_PROXY=1` tells Express to trust it (§5.6, T10).
Run it only on the server; locally use §1 (`docker-compose.dev.yml`).

### 7.1 Environment file: `.env.production` (git-ignored, never inside the image)

One file, `/opt/api-to-do-qa/.env.production` (mode 600), holds every value.
`ops/provision-db.sh` creates it on the first run with random passwords and
never overwrites an existing one. Compose reads it only for interpolation
(`docker compose --env-file .env.production ...`), and each service lists the
variables it receives, so the app container never gets `MARIADB_ROOT_PASSWORD`.
`.gitignore` keeps it out of git and `.dockerignore` keeps it out of the image.

```ini
NODE_ENV=production
PORT=4000
APP_ORIGIN=https://your.domain
TRUST_PROXY=1

# `db` is the compose service name, reached over the internal network.
DB_HOST=db
DB_PORT=3306
DB_NAME=api_to_do_qa
DB_USER=qa_app
DB_PASSWORD=<long random value>
DB_SSL=false

MIGRATE_DB_USER=qa_migrator
MIGRATE_DB_PASSWORD=<long random value>

# db service only: creates the users (§7.2) and runs the dumps (§7.4)
MARIADB_ROOT_PASSWORD=<long random value>

# read by ops/apply-db-firewall.sh
DB_ALLOWED_IPS=<ipv4 or cidr, comma-separated>
```

At startup `loadConfig` refuses to boot in production unless `TRUST_PROXY=1`,
`DB_PASSWORD` is not empty and `APP_ORIGIN` is `https://…` (T10), so a missing
or wrong variable fails immediately with a clear message instead of running
with a cookie or a proxy configuration that cannot work.

### 7.2 First start: provisioning (once)

```bash
sudo bash ops/provision-db.sh
```

It creates `.env.production` if missing, installs the firewall and daily
backup systemd units, and starts the stack. On the first start with an empty
`mariadb_data` volume the db container creates `api_to_do_qa`
(utf8mb4_unicode_ci) and runs `db/init-users.sh`, which creates:

- `qa_app` — DML only (§5.6), password `DB_PASSWORD`;
- `qa_migrator` — DML + CREATE, ALTER, INDEX, REFERENCES, and **no DROP** on
  production, password `MIGRATE_DB_PASSWORD`.

Init scripts run only on an empty volume: changing the passwords later in
`.env.production` does not change the users. Never rename or delete the
`mariadb_data` volume — it holds the production data. There is no test
database on the server: the integration tests (§5) never run in production.

The database port is bound to `127.0.0.1:3306` on the host only. To inspect
the database from your machine, open an SSH tunnel and point your client at
`127.0.0.1:3307` as `qa_migrator`:

```bash
ssh -L 3307:127.0.0.1:3306 <user>@<vps-ip>
```

### 7.3 App, migrations and first admin (inside the app container)

`deploy.sh` runs the first two steps on every deploy. Manually:

```bash
docker compose --env-file .env.production up -d --build   # the app waits for db to be healthy
docker compose --env-file .env.production exec app npm run migrate        # as qa_migrator
docker compose --env-file .env.production exec app npm run create-admin   # first admin, interactive, once
```

- `npm run migrate` takes a server-side `GET_LOCK` per database (T10): two
  simultaneous runs are impossible — the second one stops immediately with
  `another migration is already running`. Running it again is a no-op (§6).
- `docker compose exec` allocates a TTY, so `create-admin` (and
  `npm run reset-password`, §8) can read the password with hidden input.

### 7.4 Daily backup (run from the host, outside the container)

`ops/provision-db.sh` enables the `api-to-do-qa-db-backup.timer` systemd unit,
which runs `ops/backup-db.sh` every day at 02:00. The dump is produced on the
**host** and written to `/var/backups/api-to-do-qa/` (mode 700), outside the
container and the `mariadb_data` volume; files older than 14 days are deleted.

```bash
systemctl list-timers api-to-do-qa-db-backup.timer   # next run
sudo systemctl start api-to-do-qa-db-backup.service  # backup now
```

Test a restore into a scratch database from time to time.

### 7.5 Verify without a session (design §8.2 step 6)

```bash
# API without a cookie → 401 unauthenticated
curl -i https://your.domain/api/auth/me

# Protected HTML without a session → 302 to /login.html
curl -i https://your.domain/

# A QA endpoint → 401 (Origin is checked before the session, so send it)
curl -i -X POST -H "Origin: https://your.domain" \
  -H "Content-Type: application/json" -d '{}' \
  https://your.domain/api/text-reading/preview
```

Plain HTTP answers `308` to the same URL over HTTPS (T10). Then log in,
change the password and log out from the browser; only after that share the
URL with the team (§8.2 step 7).

Rollback: the QA tools keep working on the previous release; the tables are
additive and do not affect it.

## 8. Emergency password reset (`npm run reset-password`)

For shell access on the server when the only admin forgot their password
(design §5.5, S14). Like `create-admin`, the script reads `DB_*` from the
environment (or `.env` locally) and asks everything on the console:

```bash
npm run reset-password
# Email of the user to reset: qa@example.com
# Temporary password (hidden):
# Repeat password (hidden):
```

The password is never accepted as a command-line argument, so it never
lands in shell history or the process list; hidden input is stored exactly
as typed (no `trim()`), and the temporary password must pass the §5.1
policy. The command:

- replaces the password of the **existing** user (clear error and exit `1`
  if the email does not exist);
- leaves `must_change_password = 1`, so the user must pick their own
  password at next login (§5.5);
- revokes **every** live session of that user (§5.2).

It never creates users and never changes roles: `role` and `is_active` are
left untouched. Covered by `test/reset-password.test.js` (integration,
`TEST_DB_*` only, same rule as §5).
