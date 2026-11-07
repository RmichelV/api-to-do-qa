# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QA API Tester: an internal tool for QA engineers reviewing Dealer.com dealership pages. A single vanilla HTML/CSS/JS page (`public/index.html`, inline scripts, no build step) calls an Express 5 API (Node 22, ESM) that fetches the target page, isolates `.ddc-wrapper`, and returns content, H1, link, anchor and image checks. Branch `feature/login-authentication` adds login, sessions and roles on MySQL/MariaDB.

## Commands

```bash
npm install
npx playwright install chromium                 # only Anchor/Playwright fallback needs it
docker compose -f docker-compose.dev.yml up -d  # local MariaDB 10.11 on 127.0.0.1:3307
npm run migrate                                 # applies db/migrations/*.sql (uses MIGRATE_DB_* if set)
npm run create-admin                            # first admin only; interactive, hidden password
npm start                                       # node src/server.js → http://localhost:4000
npm run dev                                     # same with --watch
npm test                                        # node --test, serial (--test-concurrency=1)
node --test test/authApi.test.js                # single test file
```

- **Never run plain `docker compose up` locally**: `docker-compose.yml` is the production stack (app + Caddy on 80/443 for `bughunterssite.com`). Local dev uses `docker-compose.dev.yml`.
- Integration tests read **only** `TEST_DB_*` (database `api_to_do_qa_test`, user `qa_migrator`) and skip without them. They drop/delete data, so they must never point at `DB_*`.
- Tests run serially because all integration files share one test database.
- Config comes from env vars validated in `src/config/env.js`; locally `.env` is loaded with `process.loadEnvFile()` and existing env vars win. See `.env.example` and `db/README.md`.
- Browse via `http://localhost:4000`, not `127.0.0.1`: `originCheck` compares `Origin` against `APP_ORIGIN`.

## Architecture

- `src/server.js` is the process entry (config, pool, listen). `src/app.js` only exports `createApp({ config, pool })` and throws without them: authentication is always on. The `Dockerfile` must start `src/server.js`.
- Layers: `routes/` → `controllers/` (validate request, call service) → `services/` (logic; never read `req`, receive `req.user.id` explicitly) → `repositories/` (plain SQL via `mysql2` `pool.execute`, pool passed as a parameter) and `utils/`.
- **Middleware order in `createApp` is the security model** (design §6): security headers → JSON → `sessionMiddleware` (attaches `req.user`, never blocks) → `publicAllowList` (`/login.html`, `/login.js`, `/styles.css`, `/healthz`) → `originCheck` → public `POST /api/auth/login|logout` → `requireAuth` (default deny: API 401 `unauthenticated`, pages 302 `/login.html`) → `requirePasswordChanged` → protected auth routes → QA routers → protected static `public/` → 404/error handler. Anything mounted after `requireAuth` is protected automatically; `test/routeInventory.test.js` fails if a route answers anonymously outside the allow-list.
- `public-auth/` holds the only public pages; everything in `public/` requires a session. Static paths are resolved from `src/paths.js` (module URL), not the cwd.
- Sessions: random 256-bit token in an `HttpOnly`/`SameSite=Lax` cookie `qa_session`; DB stores only its SHA-256. Fixed 7-day expiry, rotation every 24 h with a 60 s grace for the previous token, revocation on logout/password change. Rules live in `src/services/sessionPolicy.js`.
- Passwords: scrypt from `node:crypto` (`src/services/passwordService.js`), self-describing hash string, 12–128 chars. Never `trim()` passwords. Login and change-password share the `login_attempts` rate limit (5 per email / 20 per IP in 15 min).
- Schema (MySQL 8 / MariaDB 10.4+ portable): `users` (UUID `CHAR(36)` ascii, role `ENUM('admin','qa_engineer')`, users are never deleted), `user_sessions`, `login_attempts`, `schema_migrations`. MySQL DDL commits implicitly, so keep one logical change per migration file.
- QA scraping core is `src/utils/scrapeUtils.js` (fetch + cheerio, cleanup selectors, `compareLines`) and `src/utils/normalization.js` (lowercases text). Playwright is only a fallback in `anchorReadingService.js`. Word-level diff and the QA checklist run in the browser.
- The frontend redirects to login only when an API answers `error === "unauthenticated"`; a wrong current password on change-password is also a 401 and must not log the user out.

## Workflow in this repo

- Work is tracked with ODD in `odd/tasks/login-authentication.md` (specs `S#`, tasks `T#`, `## Log`); design in `docs/auth/auth-architecture.md`. Review handoffs live in `odd/handoffs/`.
- OpenCode implements phases; Claude Code analyzes, plans and reviews. Do not start the next phase or commit/push without the user's explicit request.
- `master` is production (deployed to a Hostinger VPS with `deploy.sh`). Never change `master` directly; bring its changes into the feature branch by merging.
