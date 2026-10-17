# Database setup (local and Hostinger)

Engine: **MySQL 8.0+ or MariaDB 10.4+** (D1). The schema avoids engine-specific
features so it runs on both. Driver: `mysql2` (the only new dependency).

## 1. Local engine

Two options (design §8.1):

- **Option A — XAMPP MariaDB 10.4** (already installed here). Valid for
  development; note MariaDB 10.4 is end-of-life.
- **Option B — Docker** (recommended): same engine and major version as
  Hostinger, e.g. `mariadb:10.6` or `mysql:8.0`. Isolated and disposable.

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

Local note (2026-10-17): `qa_migrator@localhost` was created in the local
XAMPP with DDL on both databases (same password as `qa_app`, no new secret).

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

`test/db.test.js` and `test/migrate.test.js` are integration tests and read
**only `TEST_DB_*`**, never `DB_*`: they drop/truncate data, so they must never
touch the development database. Without `TEST_DB_*` they skip themselves
(7 pass, 4 skipped), and `npm test` stays green.

To enable them, point them at the **test** database. From T3 on,
`test/migrate.test.js` runs the migrations, so `TEST_DB_USER` needs DDL rights
on the test database — use `qa_migrator` (§3):

```bash
# PowerShell
$env:TEST_DB_HOST='127.0.0.1'; $env:TEST_DB_PORT='3306'
$env:TEST_DB_NAME='api_to_do_qa_test'; $env:TEST_DB_USER='qa_migrator'
$env:TEST_DB_PASSWORD='another-local-password'
npm test                 # 11 pass, 0 skip
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
