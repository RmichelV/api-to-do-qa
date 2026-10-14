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

-- migration user: also DDL (used by `npm run migrate` from T3 on)
CREATE USER 'qa_migrator'@'localhost' IDENTIFIED BY 'another-local-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON api_to_do_qa.* TO 'qa_migrator'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON api_to_do_qa_test.* TO 'qa_migrator'@'localhost';
```

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

`test/db.test.js` is an integration test and reads **only `TEST_DB_*`**, never
`DB_*`: from T3 on these tests truncate data, so they must never touch the
development database. Without `TEST_DB_*` the test skips itself (7 pass, 1
skip), and `npm test` stays green.

To enable it, point it at the **test** database:

```bash
# PowerShell
$env:TEST_DB_HOST='127.0.0.1'; $env:TEST_DB_PORT='3306'
$env:TEST_DB_NAME='api_to_do_qa_test'; $env:TEST_DB_USER='qa_app'
$env:TEST_DB_PASSWORD='your-local-password'
npm test                 # 8 pass, 0 skip
```

Or one-off from Node (uses the `DB_*` from `.env` via `loadConfig()`):

```bash
node -e "import('./src/db/pool.js').then(async m => { const pool = m.createPool(); const [[row]] = await pool.query('SELECT 1 AS ok'); console.log(row); await pool.end(); })"
```

(with the env vars set, e.g. via a local `.env`).

## 6. Hostinger integration (full steps in design §8.2)

1. Create the database and users in hPanel.
2. Set the environment variables.
3. Deploy the code.
4. Run `npm run migrate` once with the migration user (T3).
5. Run `npm run create-admin` (T4).
6. Verify login, logout, change password and that `curl` without a cookie gets
   `401` from the QA endpoints (T8+).
