# Handoff — T7: Pantallas (login, cambio de contraseña, topbar)

Fecha: 2026-10-21 · Rama: `feature/login-authentication` · Estado: **completada, sin commit, pendiente de revisión de Claude Code**
Specs: S2, S3, S4, S12 · Diseño: `docs/auth/auth-architecture.md` §6, §7.1, §7.4 · Plan: `odd/tasks/login-authentication.md` (T7, L22)

## Qué se hizo

- **Servidor** (`src/app.js`): `express.static('public-auth')` montado antes de `express.static('public')`. `/login.html` y `/login.js` quedan públicos (§7.4). El resto de la app sigue sin bloquear — la negación por defecto es T8.
- **`public-auth/login.html` + `login.js`**: formulario email/contraseña → `POST /api/auth/login`; muestra el `message` del servidor (401 `invalid_credentials`, 429 `too_many_attempts`, 400); éxito → `/`. La contraseña no se recorta (espacios significativos).
- **`public/change-password.html` + `change-password.js`**: actual, nueva, confirmación; política 12–128 visible; validación de cliente (usabilidad) respeta y muestra los errores del servidor (seguridad); `401 unauthenticated` → `/login.html`; éxito (204) → `/`.
- **`public/index.html` + `public/auth-bar.js`**: topbar con nombre del usuario (`GET /api/auth/me`), "Change password" (`/change-password.html`) y "Logout" (`POST /api/auth/logout` → `/login.html`). El script inline de QA no se tocó (S12).
- **Regla T7/L19**: redirect a `/login.html` **solo** si `status === 401 && body.error === 'unauthenticated'`, nunca ante cualquier 401. Pinned en test.
- **Estilos** (`public/styles.css`): clases auth nuevas; reutiliza `.input-group` y `.btn-run-all`.

## Evidencia

- RED: 6/8 tests de `test/pages.test.js` rojos (404 en las 5 rutas nuevas + topbar ausente).
- GREEN: **`npm test` → 85/85** con `TEST_DB_*` (Docker `api-to-do-qa-db`, 3307; 8 nuevos + los 77 de T5/T6 verdes).
- Tests nuevos: rutas de `/login.html`, `/login.js`, `/auth-bar.js`, `/change-password.html`, `/change-password.js`, `/styles.css`; `GET /index.html` sin sesión sigue sirviendo 200 (T7 no bloquea) con marcadores QA intactos + topbar nueva; `GET /api/auth/me` sin sesión → `401 { error: "unauthenticated" }`.
- Commit previo (plan, aparte): `991f297` `docs: add admin screen and emergency reset to plan`.

## Para revisar

1. `src/app.js` — orden de los static (`public-auth` antes de `public`) y comentario sobre T8.
2. Flujo de `login.js` y `change-password.js`: manejo de `response.ok`, códigos de error y redirecciones.
3. `auth-bar.js`: el redirect solo dispara con `401 && error === 'unauthenticated'`; logout siempre navega al login tras el intento.
4. `public/index.html`: el bloque `topbar__auth` y el `<script src="/auth-bar.js" defer>` no tocan la lógica QA.
5. `test/pages.test.js`: alcance y marcadores.

## Pendiente

- Sin commit de T7 y sin push (lo decides vos). T8 no empezó.
