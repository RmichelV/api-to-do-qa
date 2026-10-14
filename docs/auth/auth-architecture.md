# Authentication Architecture — api-to-do-qa

Status: **design v2 (MySQL), pending final approval.** Decisions are recorded in `odd/tasks/login-authentication.md`.
Audience: OpenCode and any developer implementing auth or linking QA runs to users.
Nothing in this document is implemented yet.

---

## 1. Current architecture (as of 2026-10-13, branch `feature/login-authentication`)

| Area | Reality |
|---|---|
| Runtime | Node.js 22 (ESM, `"type": "module"`) |
| Server | Express 5.2.1, single entry `src/app.js`, port `process.env.PORT \|\| 4000` |
| Layers | `src/routes/*` → `src/controllers/*` → `src/services/*` → `src/utils/*` |
| Frontend | **Vanilla HTML + CSS + inline JavaScript** (`public/index.html`, `public/styles.css`). No React, no bundler, no build step. Only external script: `html2pdf.js` from cdnjs. Calls the API with `fetch()` on the same origin. |
| Static serving | `app.use(express.static('public'))` — every file in `public/` is public today |
| Dependencies | `express`, `cheerio`, `playwright`. No DB driver, no session library, no dotenv |
| Persistence | None |
| Tests | None (`node --test` planned) |
| Production | Already running on a **Hostinger** server (cloud). Target: cloud production, no Windows service configuration |
| Local dev DB found | XAMPP **MariaDB 10.4.32**; Docker 29 also available |

Consequences for the design:
- The UI and the API share one origin → **cookie-based server-side sessions** are the natural fit; no CORS, no tokens stored in JavaScript.
- Express 5 forwards rejected promises from async handlers to the error handler → no extra async wrapper library.
- Node 22 ships `crypto.scrypt`, `crypto.randomUUID()` and `process.loadEnvFile()` → password hashing, UUID generation and local `.env` loading need **no new dependencies**.

---

## 2. Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Database | **MySQL-compatible** (MySQL 8.0+ or MariaDB 10.4+) | Hostinger compatibility (D1). Schema avoids engine-specific features so it runs on both. |
| Driver | **`mysql2`** (promise API, `pool.execute()` prepared statements) | The standard maintained MySQL driver for Node; prepared statements prevent SQL injection; pure JavaScript, no native build. **The only new dependency.** |
| Data access | **Plain SQL in repository modules, no ORM** | Two tables, simple queries; an ORM would add a dependency and a second abstraction without benefit (D2). |
| Migrations | **Numbered `.sql` files + small runner `scripts/migrate.js`** | Same files run locally and on Hostinger; no migration framework to learn (D2). |
| Password hashing | **scrypt from `node:crypto`** | Accepted by OWASP, zero dependencies, no native compilation, so it works on any Hostinger Node.js plan (D3). |
| Sessions | **Own server-side sessions in MySQL** (`user_sessions`) with an `HttpOnly` cookie | Immediate logout/revocation, works across process restarts and multiple instances, no session library needed. |
| IDs | **UUID v4** generated in Node (`crypto.randomUUID()`), stored as `CHAR(36)` | D5. Portable across MySQL and MariaDB (`UUID_TO_BIN` is MySQL-only, MariaDB's `UUID` type is MariaDB-only). |
| Config | Environment variables; local `.env` via `process.loadEnvFile()` when the file exists | Production uses the hosting panel's environment variables; no dotenv. |

Why not JWT: logout and "revoke all sessions on password change" must be immediate, and the frontend is same-origin. A session row is trivially revocable; JWT would need refresh-token machinery for no gain.

Why not migrate the frontend: login and change-password are small forms; plain HTML pages reusing `styles.css` are enough.

---

## 3. Target file structure

```
.env.example                         # documented config (committed, no secrets)
db/
  migrations/
    001_create_users.sql
    002_create_user_sessions.sql
    003_create_login_attempts.sql
  README.md                          # local DB setup (XAMPP or Docker) + Hostinger steps
scripts/
  migrate.js                         # applies db/migrations/*.sql in order
  create-admin.js                    # bootstrap / emergency admin creation from CLI
src/
  app.js                             # createApp(): middleware + routes (no listen)
  server.js                          # process entry: load config, createApp(), listen
  config/
    env.js                           # reads + validates env vars, exports frozen config
  db/
    pool.js                          # single mysql2 pool
  repositories/
    userRepository.js
    sessionRepository.js
    loginAttemptRepository.js
  services/
    passwordService.js               # hash / verify / needsRehash / validatePolicy
    authService.js                   # login, logout, changePassword, resolveSession
    userAdminService.js              # create user, list, update role/active, reset password
  middleware/
    sessionMiddleware.js             # cookie → req.user, sliding/rotation logic
    requireAuth.js                   # API: 401 JSON · pages: 302 /login.html
    requireRole.js                   # 403 unless role matches
    requirePasswordChanged.js        # blocks everything while must_change_password
    originCheck.js                   # CSRF defense for state-changing requests
    securityHeaders.js               # no-store for HTML/API, frame/sniff headers
    errorHandler.js                  # uniform JSON errors, no stack traces in production
  controllers/
    authController.js
    adminUsersController.js
  routes/
    authRoutes.js                    # /api/auth/*
    adminUsersRoutes.js              # /api/admin/users/*
public/                              # PROTECTED: served only to authenticated users
  index.html
  styles.css                         # also listed in the public allow-list (needed by login)
  change-password.html
  change-password.js
public-auth/                         # PUBLIC: the only files reachable without a session
  login.html
  login.js
test/
  ...                                # node --test
```

Moving the login page to its own folder (`public-auth/`) makes the frontend rule structural: **nothing in `public/` can ever be served to an anonymous user by mistake**.

---

## 4. Database schema (MySQL 8.0+ / MariaDB 10.4+, InnoDB, utf8mb4)

Portability rules:
- Engine `InnoDB` (foreign keys, transactions), charset `utf8mb4`, collation `utf8mb4_unicode_ci` (exists in both engines; `utf8mb4_0900_*` is MySQL-only).
- Roles use `ENUM`, which is enforced by both engines (`CHECK` is ignored by MySQL < 8.0.16).
- Times are `DATETIME(3)` stored in **UTC**: the pool sets `timezone: 'Z'` and each connection runs `SET time_zone = '+00:00'`. `TIMESTAMP` is avoided because of its 2038 limit and session time-zone conversions.
- UUIDs are `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`, generated by the app.
- The app runs MySQL in strict mode for its session: `SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'`.

### 4.1 `users`

```sql
CREATE TABLE users (
  id                   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  email                VARCHAR(254) NOT NULL,
  full_name            VARCHAR(120) NOT NULL,
  role                 ENUM('admin', 'qa_engineer') NOT NULL,
  password_hash        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  password_changed_at  DATETIME(3) NOT NULL,
  last_login_at        DATETIME(3) NULL,
  created_by           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at           DATETIME(3) NOT NULL,
  updated_at           DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_uq (email),
  CONSTRAINT users_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Rules:
- The app stores email **trimmed and lowercased**; the case-insensitive collation also makes the unique key case-insensitive.
- Timestamps are set by the app in UTC (explicit values, no engine-dependent defaults).
- Users are **never deleted** (future QA rows reference them). Disable with `is_active = 0`.
- `created_by` is NULL only for an admin created by `scripts/create-admin.js`.

### 4.2 `user_sessions`

```sql
CREATE TABLE user_sessions (
  id                  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash          BINARY(32) NOT NULL,            -- SHA-256 of the cookie token, never the token
  previous_token_hash BINARY(32) NULL,                -- accepted briefly after rotation (see 5.2)
  rotated_at          DATETIME(3) NOT NULL,
  created_at          DATETIME(3) NOT NULL,
  last_seen_at        DATETIME(3) NOT NULL,
  expires_at          DATETIME(3) NOT NULL,           -- created_at + 7 days, never extended
  revoked_at          DATETIME(3) NULL,
  user_agent          VARCHAR(255) NULL,
  ip_address          VARCHAR(45) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_sessions_token_uq (token_hash),
  KEY user_sessions_prev_token_idx (previous_token_hash),
  KEY user_sessions_user_idx (user_id),
  KEY user_sessions_expires_idx (expires_at),
  CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 4.3 `login_attempts` (brute-force protection that survives restarts and multiple instances)

```sql
CREATE TABLE login_attempts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email        VARCHAR(254) NOT NULL,
  ip_address   VARCHAR(45) NOT NULL,
  succeeded    TINYINT(1) NOT NULL,
  attempted_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY login_attempts_email_time_idx (email, attempted_at),
  KEY login_attempts_ip_time_idx (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Rows older than 24 h are deleted opportunistically on login; it is an operational log, not business data.

### 4.4 `schema_migrations` (created by `scripts/migrate.js`)

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(100) NOT NULL PRIMARY KEY,   -- e.g. '001_create_users'
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**MySQL-specific migration rule:** DDL statements (`CREATE`, `ALTER`) commit implicitly, so a migration cannot be rolled back as a whole. Therefore:
- one logical change per file, using `CREATE TABLE IF NOT EXISTS` where possible;
- the runner applies files in order, records the version only after the file succeeds, and stops at the first error;
- the runner uses its own connection with `multipleStatements: true`; the application pool keeps `multipleStatements: false`.

### 4.5 Reserved for later: QA linkage (NOT part of this feature)

Contract for the developer who will store QA runs:

```sql
-- future migration, e.g. 00X_create_qa_runs.sql
CREATE TABLE qa_runs (
  id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_url  VARCHAR(2048) NOT NULL,
  check_type  VARCHAR(40) NOT NULL,     -- e.g. 'full_analysis', 'text_desktop', 'anchors'
  result      LONGTEXT NOT NULL,        -- JSON serialized by the app (portable across MySQL/MariaDB)
  created_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY qa_runs_user_created_idx (user_id, created_at),
  CONSTRAINT qa_runs_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

What auth guarantees to that developer:
1. Every QA endpoint runs behind `requireAuth`, so **`req.user.id` (UUID string) is always present**.
2. `req.user` shape: `{ id, email, fullName, role, mustChangePassword }`.
3. Users are never deleted, so `ON DELETE RESTRICT` is safe.
4. The `user_id` column type must match `users.id` exactly (`CHAR(36)` ascii), or MySQL rejects the foreign key.
5. Controllers pass `req.user.id` to services explicitly; services never read `req`.

---

## 5. Security design

### 5.1 Passwords
- **scrypt** (`node:crypto`), parameters `N=2^17, r=8, p=1, keylen=64`, `maxmem=256 MiB`, random 16-byte salt.
- Stored as a self-describing string: `scrypt$N=131072,r=8,p=1$<salt_b64>$<hash_b64>`, so the parameters can be raised later (`needsRehash` → rehash on the next successful login).
- Comparison with `crypto.timingSafeEqual`.
- Policy (NIST SP 800-63B): 12–128 characters, must differ from the current password, no forced composition rules.
- A login with an unknown or inactive email still runs a dummy verification to keep response timing uniform.

### 5.2 Sessions: 7-day policy (D4)

| Rule | Value |
|---|---|
| Lifetime | **7 days from login, fixed.** `expires_at` is never extended; after 7 days the user logs in again. |
| Renewal (token rotation) | Every **24 h of use**, the next authenticated request gets a new token (new cookie), and the old hash moves to `previous_token_hash`. Expiry does not change. |
| Rotation grace | The previous token is accepted for **60 seconds** after rotation (parallel requests from the same page), then rejected. |
| Activity tracking | `last_seen_at` is updated at most once every 5 minutes (avoids a write per request). |
| Cookie | `qa_session`, `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, `Max-Age` = seconds remaining until `expires_at`. |
| Token | `crypto.randomBytes(32)` as base64url; only `SHA-256(token)` is stored. |
| Login | Always creates a new session (prevents session fixation). |
| Logout | Sets `revoked_at` and clears the cookie. |
| Password change | Revokes **all other** sessions of the user and rotates the current one. |
| Admin reset password / deactivate user | Revokes **all** sessions of that user. |
| Cleanup | Expired and revoked rows older than 7 days are purged opportunistically on login; no cron needed. |

### 5.3 CSRF
- `SameSite=Lax` keeps the cookie off cross-site `POST`s.
- `originCheck`: for `POST/PUT/PATCH/DELETE`, the `Origin` (or `Referer`) must match `APP_ORIGIN`; otherwise `403 { error: "invalid_origin" }`.
- The API only accepts `application/json` bodies.

### 5.4 Brute force
- Using `login_attempts`: max **5 failed attempts per email in 15 min**, and **20 per IP in 15 min** → `429 too_many_attempts`.
- The error message is always generic and never reveals whether the email exists or is inactive.

### 5.5 Forced password change
- Accounts created by an admin and admin resets set `must_change_password = 1`.
- While it is set, `requirePasswordChanged` allows only `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout` and the change-password page. Every other API returns `403 { error: "password_change_required" }` and every other page redirects to `/change-password.html`.

### 5.6 Production hardening (Hostinger cloud)
- `app.set('trust proxy', 1)`: Hostinger serves Node behind a reverse proxy; needed for the correct client IP (rate limit) and for HTTPS detection.
- In production, HTTP requests are redirected to HTTPS and `Strict-Transport-Security` is set.
- `securityHeaders`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and `Cache-Control: no-store` on protected HTML and on every `/api/*` response, so protected pages are not served from browser or proxy caches after logout.
- `errorHandler` never returns stack traces or SQL errors to the client in production.
- The MySQL user for the app has only `SELECT, INSERT, UPDATE, DELETE` on the app schema; migrations run with a user that also has `CREATE, ALTER, INDEX, REFERENCES`.

---

## 6. Protection model: frontend AND API, enforced on the server

The login redirect is **not** the protection; it is only the user experience. Protection is enforced by Express before any protected byte is sent.

Middleware order in `createApp()`:

```
1. trust proxy, HTTPS redirect (production), securityHeaders
2. express.json()
3. sessionMiddleware            → sets req.user or leaves it undefined (never blocks)
4. PUBLIC allow-list:
     GET  /login.html, /login.js           (from public-auth/)
     GET  /styles.css                       (shared stylesheet)
     POST /api/auth/login                   (+ originCheck)
     GET  /healthz                          (returns only {"status":"ok"}, no data)
5. originCheck                  → every state-changing request
6. requireAuth                  → DEFAULT DENY for everything below:
     API request  → 401 { error: "unauthenticated" }
     page request → 302 /login.html
7. requirePasswordChanged
8. /api/auth/{logout,me,change-password}
9. /api/admin/users/*  (requireRole('admin'))
10. existing QA routers: /api/text-reading, /api/text-reading-mobile, /api/link-reading,
    /api/anchor-reading, /api/full-analysis, /api/cancel
11. express.static('public', { index: false }) + GET / → public/index.html
12. 404 handler, errorHandler
```

Guarantees:
- **Default deny:** any route or static file added in the future is protected automatically, because it is mounted after `requireAuth`. Only the explicit allow-list in step 4 is public.
- The QA tools' HTML (`index.html`) is never sent to anonymous users: the server answers `302`, so there is nothing to bypass by disabling JavaScript or calling URLs directly.
- Every QA endpoint (including `/api/cancel` and `/api/link-reading/statuses`) answers `401` without a valid session, even when called with `curl`.
- The browser-side check (`/api/auth/me` on load + redirect on any `401`) only handles sessions that expire while a page is open.

Verification (phase T8): a **route inventory test** walks the Express router stack, collects every registered route and static file, and asserts that each one answers `401`/`302` without a session, except the allow-list in step 4. A new route that is not protected makes the test fail.

---

## 7. API endpoints

All JSON. Errors: `{ "error": "<code>", "message": "<human text>" }`.

### 7.1 Auth (`/api/auth`)

| Method | Path | Access | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | public | `{ email, password }` | `200 { user }` + `Set-Cookie` | `400 validation_error`, `401 invalid_credentials`, `429 too_many_attempts` |
| POST | `/api/auth/logout` | session | — | `204` + cleared cookie | — (idempotent) |
| GET | `/api/auth/me` | session | — | `200 { user }` | `401 unauthenticated` |
| POST | `/api/auth/change-password` | session | `{ currentPassword, newPassword }` | `204` | `400 validation_error`, `401 invalid_credentials` |

### 7.2 Admin users (`/api/admin/users`, role `admin`)

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/admin/users` | — | `200 { users: [...] }` (never includes `password_hash`) |
| POST | `/api/admin/users` | `{ email, fullName, role, temporaryPassword }` | `201 { user }` |
| PATCH | `/api/admin/users/:id` | `{ fullName?, role?, isActive? }` | `200 { user }` |
| POST | `/api/admin/users/:id/reset-password` | `{ temporaryPassword }` | `204` |

Guards: an admin cannot deactivate or demote **themselves**, and at least one active admin must remain (`409 last_admin`).
Account creation runs through this API (or `scripts/create-admin.js` for the first admin). An admin screen is **not** part of this plan (see D6 in the feature document).

### 7.3 Existing QA endpoints
Unchanged handlers and response contracts, now behind `requireAuth` and `requirePasswordChanged`.

### 7.4 Pages

| Path | Access |
|---|---|
| `/login.html`, `/login.js`, `/styles.css` | public |
| `/`, `/index.html` and every other file in `public/` | session required, else `302 /login.html` |
| `/change-password.html` | session required (also reachable while `must_change_password`) |

The change-password screen (D6) has three fields: current password, new password, confirm new password. It shows the policy, validates on the client for usability and on the server for security, and after success returns to `/`. It is reachable from a "Change password" button in the top bar of `index.html`, next to the user's name and "Logout".

---

## 8. Configuration and environments

| Variable | Local example | Hostinger production |
|---|---|---|
| `NODE_ENV` | `development` | `production` (enables `Secure` cookie, HTTPS redirect, HSTS) |
| `PORT` | `4000` | value assigned by the hosting |
| `APP_ORIGIN` | `http://localhost:4000` | `https://<your-domain>` |
| `DB_HOST` | `127.0.0.1` | value shown in hPanel → Databases |
| `DB_PORT` | `3306` | `3306` |
| `DB_NAME` | `api_to_do_qa` | the Hostinger database name (usually prefixed, e.g. `u123_api_to_do_qa`) |
| `DB_USER` | `qa_app` | the Hostinger database user |
| `DB_PASSWORD` | local password | set only in the hosting panel |
| `DB_SSL` | `false` | `true` if the database is reached over a network; `false` if it is on the same host |
| `DB_CONNECTION_LIMIT` | `5` | `5` (shared plans limit connections per user) |
| `SESSION_DAYS` | `7` | `7` |
| `TRUST_PROXY` | `0` | `1` |

- Local: `.env` (git-ignored) loaded with `process.loadEnvFile()` **only if the file exists**.
- Production: variables set in the Hostinger panel. No `.env` file with real secrets on the server unless the plan offers no panel for variables; in that case the file lives outside the web root with permissions limited to the app user.
- `src/config/env.js` validates every required variable at startup and exits with a clear message. There is no "auth disabled" mode.
- Separate MySQL users for runtime and migrations (§5.6).

### 8.1 Local development and testing
1. Use an engine close to production. Check the version on Hostinger first (`SELECT VERSION();` in phpMyAdmin).
2. Option A: the existing **XAMPP MariaDB 10.4**. Valid for development; note that MariaDB 10.4 is end-of-life.
3. Option B (recommended): **Docker** with the same engine and major version as Hostinger, e.g. `mariadb:<version>` or `mysql:8.0`. It is isolated and disposable, and gives the same behavior as production.
4. Databases: `api_to_do_qa` (development) and `api_to_do_qa_test` (automated tests, truncated by the tests).

### 8.2 Integration into Hostinger
1. Create the database and users in hPanel.
2. Set the environment variables.
3. Deploy the code.
4. Run `npm run migrate` once with the migration user.
5. Run `npm run create-admin` to create the first admin.
6. Verify login, logout, change password and that `curl` without a cookie gets `401` from the QA endpoints.
7. Only then share the URL with the team.

Rollback: the QA tools keep working on the previous release; the new tables are additive and do not affect it.

---

## 9. Changes to existing files (minimal)

| File | Change |
|---|---|
| `package.json` | add `mysql2`; scripts `start` → `node src/server.js`, `dev`, `migrate`, `create-admin`, `test` |
| `src/app.js` | becomes `createApp()` with the middleware order of §6; the existing routers are mounted unchanged |
| `src/server.js` (new) | loads config, connects the pool, `listen` |
| `public/index.html` | top bar: user name, "Change password", "Logout"; on any `401` → `/login.html`. No change to the QA logic |
| `.env.example`, `README.md`, `db/README.md` | setup, migration and deployment documentation |

No change to scraping, comparison, link or anchor services, or to the QA response contracts.

---

## 10. Testing strategy

- Runner: `node --test` (built in); script `"test": "node --test \"test/**/*.test.js\""` (verified on Windows).
- Unit tests (no DB): `passwordService`, policy validation, `requireRole`, `originCheck`, cookie options, session expiry and rotation rules (time injected, not real clocks).
- Integration tests (real MySQL/MariaDB): database `api_to_do_qa_test` from `TEST_DB_*` variables; migrated once, tables truncated per test file. HTTP calls use native `fetch` against `createApp().listen(0)`, with no supertest.
- Every endpoint test asserts the status code, body shape, cookie flags, and the database effect (session created, rotated or revoked; hash changed).
- Protection tests: the route inventory test (§6) plus `curl`-style requests without a cookie against every QA endpoint and page.
