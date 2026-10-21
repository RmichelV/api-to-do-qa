# Handoff — T8: Protección en servidor (negación por defecto)

Fecha: 2026-10-21 · Rama: `feature/login-authentication` · Estado: **completada · aprobada con 2 correcciones (L25) · commiteada (sin push)**
Specs: S9, S11, S12 · Diseño: `docs/auth/auth-architecture.md` §5.6, §6, §7.1 · Plan: `odd/tasks/login-authentication.md` (T8, L24/L25)

## Qué se hizo

- **`src/app.js`**: reescrito con el orden de §6 — `securityHeaders` → `express.json` → `sessionMiddleware` → allow-list pública → `originCheck` (global) → `POST /api/auth/login` y `POST /api/auth/logout` (públicos, L25) → `requireAuth` (default deny) → `requirePasswordChanged` → `me/change-password` → routers QA + `POST /api/cancel` → `express.static(PUBLIC_DIR, { index: false })` → `GET /` → `index.html` → `notFoundHandler` (404 JSON) → `errorHandler`. **El modo sin auth de `createApp()` se eliminó**: exige `config` y `pool`, si faltan lanza.
- **`src/middleware/requireAuth.js`** (nuevo): API → `401 { error: "unauthenticated" }`; páginas → `302 /login.html`.
- **`src/middleware/publicAllowList.js`** (nuevo): `GET /login.html`, `/login.js` (desde `public-auth/`), `/styles.css` (desde `public/`), `GET /healthz` → `{"status":"ok"}`.
- **`src/paths.js`** (nuevo): `PUBLIC_DIR` y `PUBLIC_AUTH_DIR` resueltos desde `import.meta.url`, no desde `cwd`.
- **`src/routes/authRoutes.js`**: ganó filtro `only` (`['login','logout']` vs `['me','change-password']`, L25) para montar login y logout públicos y el resto detrás de `requireAuth`; firma pública S11 intacta.
- **`src/middleware/errorHandler.js`**: agregó `notFoundHandler` (404 JSON).
- **`originCheck` global**: state-changing sin `Origin`/`Referer` → `403 invalid_origin` (los tests envían `Origin: APP_ORIGIN`).
- **Corrección 1 (L25)**: `securityHeaders` aplica `Cache-Control: no-store` también al HTML (`GET /`, paths `.html`, y por lo tanto también el 302 a `/login.html`), además de `/api/*`.
- **Corrección 2 (L25)**: `POST /api/auth/logout` montado con login, antes de `requireAuth` (con `originCheck`): revoca si hay cookie válida y siempre limpia la cookie con 204 (§7.1 idempotente). Diseño §6/§7.1 alineado.
- **Tests**: `test/routeInventory.test.js` (nuevo) — walker sobre `app.router.stack` parcheando `express.application.use` para recuperar prefijos de mount (Express 5 no los guarda) + enumeración `fs` de `public/` y `public-auth/`; cualquier ruta/archivo fuera de la allow-list sin sesión debe dar 401/302. `test/pages.test.js` y `test/smoke.test.js` reescritos al modelo con sesión (`TEST_DB_*`).

## Comportamiento que sigue cambiando (revisar)

- **Re-login con `must_change_password` activo → 200 con el flag** (antes 403). Login es público en step 4, arriba del gate step 7. El gate igual bloquea el resto de la API (403) y las páginas (302). Ajustado el test §5.5 de `test/changePassword.test.js`.

## Evidencia

- RED: 8/15 tests rojos antes de implementar.
- GREEN final: **`npm test` → 93/93** con `TEST_DB_*` (Docker `api-to-do-qa-db`, 3307; `--test-concurrency=1`).
- `fetch` sigue redirects por defecto: los asserts de 302 usan `redirect: 'manual'` (patrón T6).

## Para revisar

1. `src/app.js` — orden de middlewares vs. §6 (actualizado), paso a paso.
2. `publicAllowList.js` + `paths.js` — allow-list exacta y resolución por `import.meta.url`.
3. `requireAuth.js` — 401 JSON vs 302 HTML por tipo de path.
4. `securityHeaders.js` — la condición de HTML (`/` o `.html`) incluye `/login.html` público; se dejó a propósito (política de HTML completa, §5.6).
5. `authRoutes.js` — el filtro `only` no cambia la firma pública (S11) ni los contratos.
6. `test/routeInventory.test.js` — la estrategia del walker y que cubra `public/` entero.

## Pendiente

- Commiteada en `feature/login-authentication` (sin push, decisión de la usuaria). T9 no empezó.
