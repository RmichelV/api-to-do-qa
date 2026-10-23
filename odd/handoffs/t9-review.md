# T9 — Admin users API (handoff de revisión)

**Autorización (L28, 2026-10-23):** "Autorizo T9 de odd/tasks/login-authentication.md (diseño §7.2). Leé solo la fila T9, S1, S5 y §7.2. requireRole('admin') + /api/admin/users (GET, POST, PATCH /:id, POST /:id/reset-password), montado en el paso 9 de §6. Nunca devolver password_hash. Guards: no auto-degradarse/desactivarse, siempre ≥1 admin activo (409 last_admin). Reset y desactivar revocan todas las sesiones; temporaryPassword deja must_change_password=1. Test primero, solo TEST_DB_*. npm test. Fila T9 + Log + Engram, handoff corto en odd/handoffs/t9-review.md. Sin commit ni push. No empieces T9b."

**Alcance leído:** fila `T9`, specs `S1` y `S5`, diseño §7.2 (más §6 step 9 para el montaje). `T9b` y `T9c` **no** empezadas.

## Qué se hizo

| Archivo | Cambio |
|---|---|
| `src/middleware/requireRole.js` | nuevo: sin `req.user` → 401 `unauthenticated`; rol distinto → 403 `forbidden` |
| `src/app.js` | §6 step 9: `app.use('/api/admin/users', requireRole('admin'), adminUserRoutes({ pool }))` entre `me/change-password` y los routers QA |
| `src/routes/adminUserRoutes.js` | nuevo: GET `/`, POST `/`, PATCH `/:id`, POST `/:id/reset-password` |
| `src/controllers/adminUserController.js` | nuevo: adaptador HTTP delgado (§4.5) |
| `src/services/adminUserService.js` | nuevo: validación, guards, serialización |
| `src/repositories/userRepository.js` | `listAll`, `updateUser`, `setTemporaryPassword`, `listActiveAdminIdsForUpdate` |
| `test/adminUsers.test.js` | nuevo: 8 tests de integración |

## Contratos (§7.2)

- `GET /api/admin/users` → `200 { users: [...] }` (orden `created_at`, `id`)
- `POST /api/admin/users` → `201 { user }` — `{ email, fullName, role, temporaryPassword }`, `created_by` = admin actor
- `PATCH /api/admin/users/:id` → `200 { user }` — `{ fullName?, role?, isActive? }`
- `POST /api/admin/users/:id/reset-password` → `204` — `{ temporaryPassword }`
- **`password_hash` nunca sale**: `toAdminUserShape` es una allow-list explícita; el test escanea el JSON completo de las respuestas.

Errores: 401 `unauthenticated`, 403 `forbidden` (rol), 403 `invalid_origin` (global), 400 `validation_error` (campos desconocidos, rol fuera de `admin|qa_engineer`, `isActive` no booleano, política de contraseña), 404 `user_not_found`, 409 `email_exists`, 409 `last_admin`, 409 `self_change`.

## Guards — decisión a revisar

1. Si el patch quitaría un admin activo → transacción con `SELECT … FOR UPDATE` sobre los admins activos; sin ningún **otro** admin ⇒ `409 last_admin`.
2. Si el target es el propio admin ⇒ `409 self_change`.
3. **Orden: invariante primero.** Detrás de `requireRole` el actor siempre es un admin activo, así que por HTTP lo único alcanzable cuando no queda otro admin es el caso "único admin que se degrada a sí mismo" ⇒ recibe `last_admin` (la causa real). Con otro admin vivo, cambiarse a uno mismo ⇒ `self_change`.

Otras decisiones que conviene mirar:

- **`password_changed_at` no se sella en el reset** (lo sella el cambio propio del usuario, §5.1). Asunción pendiente de confirmación.
- Reset y desactivar → `revokeAllForUser` sobre **todas** las sesiones (§5.2); `create` y `reset` dejan `must_change_password = 1` (§5.5).
- `requireRole` vive solo en el mount de `app.js` (igual que el resto de guards de §6); `test/routeInventory.test.js` **no** detecta un mount sin `requireRole`, así que el pin es `test/adminUsers.test.js` (qa_engineer → 403 en las 4 rutas).

## Evidencia

- **RED**: 8/8 tests rojos en `test/adminUsers.test.js` (404 en las 4 rutas).
- **GREEN**: `node --test --test-concurrency=1 "test/**/*.test.js"` → **101/101 con `TEST_DB_*`** (Docker 3307; 8 tests nuevos sobre los 93 de T8, sin skips, sin fallos).
- **Verificación independiente** (`gentle-ai-verify`, en copia scratch + probes propios): **pass, 0 blockers, 3 advisories** — (1) `requireRole` solo en el mount, pinneado por test; (2) `CLAUDE.md` sin trackear es ajeno a T9; (3) la raza del `FOR UPDATE` está razonada, no probada con concurrencia real.
- Riesgo: **item 2 (seguridad/permisos)** → por eso la verificación independiente.

## Estado del repositorio

- **Sin commit, sin push** (instrucción explícita). `git status`: modificados `src/app.js`, `src/repositories/userRepository.js`; nuevos `src/middleware/requireRole.js`, `src/routes/adminUserRoutes.js`, `src/controllers/adminUserController.js`, `src/services/adminUserService.js`, `test/adminUsers.test.js` (+ el handoff y las filas del plan).
- `CLAUDE.md` sigue sin trackear y **no** forma parte de T9.
- Plan actualizado: fila `T9` (estado + evidencia), línea de estado general y `L28` en el `## Log`; espejo Engram `odd/login-authentication/tasks`.
- Siguiente después de la revisión: commit de cierre de T9 y luego `T9b`.
