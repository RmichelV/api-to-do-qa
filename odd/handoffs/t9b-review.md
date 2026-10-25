# T9b — Pantalla de administración de usuarios (handoff de revisión)

**Autorización (L30, 2026-10-25):** "Autorizo T9b de odd/tasks/login-authentication.md. Leé solo la fila T9b, S13 y §7.2. public/admin-users.html + admin-users.js (vanilla, reutiliza styles.css) sobre la API de T9: listar, crear con contraseña temporal, cambiar rol, activar/desactivar, resetear contraseña. Mostrar los errores de la API (409 last_admin, self_change, email_exists). La página solo para admin en el servidor (403 si no es admin aunque escriba la URL). Botón "Users" en la barra de index.html solo visible para admins. Ajuste: el reset de la propia cuenta por esta API → 409 self_change (usar "Change password"). Test primero, solo TEST_DB_*. npm test. Fila T9b + Log + Engram, handoff en odd/handoffs/t9b-review.md. Sin commit ni push. No toques CLAUDE.md. No empieces T9c."

**Alcance leído:** fila `T9b`, spec `S13`, diseño §7.2 (más §6 step 11 para el montaje del guard). `T9c` **no** empezada.

## Qué se hizo

| Archivo | Cambio |
|---|---|
| `public/admin-users.html` | nuevo: topbar (reutiliza `auth-bar.js`), alta de usuarios, tabla y `<dialog>` de reset |
| `public/admin-users.js` | nuevo: cliente delgado de §7.2 (list/create/patch/reset), `textContent` en todo, sin `innerHTML` |
| `src/middleware/requireAdminPage.js` | nuevo: guard de **páginas** admin-only → 403 HTML (no el JSON de `requireRole`) |
| `src/app.js` | §6 step 11: `app.use(requireAdminPage(['/admin-users.html', '/admin-users.js']))` antes de `express.static` |
| `src/controllers/adminUserController.js` | pasa `actorId` a `resetPassword` |
| `src/services/adminUserService.js` | **ajuste**: self-reset → `409 self_change` |
| `public/index.html` | `#auth-users` (href `/admin-users.html`) con `hidden` en la topbar |
| `public/auth-bar.js` | revela `#auth-users` solo si `user.role === 'admin'` |
| `public/styles.css` | bloque `.admin-*` aislado (tabla, badges, grid del form, `input[type=email|password]` y `select` **solo** dentro de `.admin-card`) |
| `test/adminUsersPage.test.js` | nuevo: 4 tests de integración |
| `test/adminUsers.test.js` | +1: guard de self-reset |
| `test/routeInventory.test.js` | archivos admin-only → 302 anónimo / 403 no-admin / 200 admin (crea un admin además del `qa_engineer`) |

## Protección de la página (decisión a revisar)

El orden de §6 no cambia; el guard entra **antes** de `express.static`:

1. anónimo → `requireAuth` responde **302 `/login.html`** (igual que el resto de `public/`);
2. `must_change_password` → `requirePasswordChanged` responde **302 `/change-password.html`**;
3. sesión no-admin → **403** con página HTML que nombra el rol (aunque se escriba la URL);
4. admin → 200.

`requireRole` de T9 sigue respondiendo **403 `forbidden` en JSON** para la API. El guard de páginas es un middleware sin ruta (`app.use(fn)`), así que **no aparece en el inventario de rutas** de `test/routeInventory.test.js`; el pin es el test de archivos estáticos (302/403/200) más `test/adminUsersPage.test.js`.

## Ajuste de la API (autorizado en L30)

- `POST /api/admin/users/:id/reset-password` con `id === actorId` → **409 `self_change`**, mensaje `Admins cannot reset their own account here. Use "Change password".`
- Motivo: ese reset revoca **todas** las sesiones del usuario (§5.2), incluida la del admin que lo pide; la pantalla lo redirige a "Change password".
- Orden dentro del servicio: validar body (400) → `requireUser` (404) → guard (409). Un id inexistente jamás puede ser el `actorId`, así que el orden 404/409 no es observable.
- El test nuevo usa **dos** admins activos, para probar que la respuesta es `self_change` y no `last_admin`, y verifica que hash y sesión quedan intactos.

## Errores mostrados en pantalla

`message` del servidor + un hint de siguiente paso (solo si el mensaje no lo dice ya):

| Código | Hint |
|---|---|
| `409 last_admin` | Promote another active admin first, then retry. |
| `409 self_change` | Use "Change password" in the top bar to change your own password. (en el reset **no** se agrega: el mensaje del server ya lo dice) |
| `409 email_exists` | Sign in as that user, or reset its password from this list. |

También se muestran `404 user_not_found`, `400 validation_error` y `403 forbidden` tal como vienen. Regla T7 intacta y pinneada: redirect a `/login.html` **solo** con `401 && error === 'unauthenticated'`.

## Evidencia

- **RED**: 5 tests rojos — los 4 de `test/adminUsersPage.test.js` (404 en `/admin-users.html`, sin `#auth-users` en `index.html`) + el guard de self-reset en `test/adminUsers.test.js` (204 en lugar de 409).
- **GREEN**: `npm test` (`node --test --test-concurrency=1 "test/**/*.test.js"`) → **106/106 con `TEST_DB_*`** (Docker 3307; 5 tests nuevos sobre los 101 de T9, **0 skips**, 0 fallos, ~165 s).
- `node --check` en `admin-users.js`, `auth-bar.js` y `requireAdminPage.js` → OK.
- Riesgo: **item 2 (permisos)** y **item 3 (contrato de un endpoint público: el self-reset pasa de 204 a 409)** → ambos disparan verificación independiente.

## Estado del repositorio

- **Sin commit, sin push** al momento de escribir el handoff (instrucción explícita; el commit de cierre llega con la aprobación, ver "Cierre"). `git status`: modificados `public/auth-bar.js`, `public/index.html`, `public/styles.css`, `src/app.js`, `src/controllers/adminUserController.js`, `src/services/adminUserService.js`, `test/adminUsers.test.js`, `test/routeInventory.test.js`; nuevos `public/admin-users.html`, `public/admin-users.js`, `src/middleware/requireAdminPage.js`, `test/adminUsersPage.test.js` (+ este handoff y las filas del plan).
- `CLAUDE.md` sigue sin trackear y **no** se tocó.
- Plan actualizado: fila `T9b` (estado + evidencia), línea de estado general y `L30` en el `## Log`; espejo Engram `odd/login-authentication/tasks`.
- **Cierre (L31):** aprobado por Claude Code (106/106). **Estrategia de PR diferida a T10** por decisión de la usuaria (el forecast supera las ~400 líneas, pero la elección del encadenamiento no se hace ahora).
- Commit de cierre: `feat: add admin users screen with role-gated page (T9b)`, **sin push**, solo archivos de T9b (`CLAUDE.md` excluido).
- Siguiente: `T9c` (CLI de emergencia), pendiente de autorización.
