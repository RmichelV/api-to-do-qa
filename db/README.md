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

`docker-compose.yml` (without `.dev`) is the **production** stack (app + Caddy,
from `master`); do not use it for local development.

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

`test/db.test.js`, `test/migrate.test.js`, `test/userRepository.test.js` and
`test/create-admin.test.js` are integration tests and read **only `TEST_DB_*`**,
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

## 7. Hostinger integration (full steps in design §8.2)

1. Create the database and users in hPanel.
2. Set the environment variables.
3. Deploy the code.
4. Run `npm run migrate` once with the migration user (T3).
5. Run `npm run create-admin` (T4).
6. Verify login, logout, change password and that `curl` without a cookie gets
   `401` from the QA endpoints (T8+).
