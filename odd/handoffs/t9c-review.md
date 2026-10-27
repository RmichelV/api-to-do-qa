# T9c — CLI de emergencia reset-password (handoff de revisión)

**Autorización (L32, 2026-10-26):** "Autorizo T9c de odd/tasks/login-authentication.md. Leé solo la fila T9c y S14.
- scripts/reset-password.js + script npm "reset-password", mismo patrón que create-admin (input oculto, sin trim en la contraseña, sin argumentos visibles).
- Pide email y contraseña temporal (dos veces), valida la política, deja must_change_password=1, revoca todas las sesiones del usuario. Error claro si el email no existe. No crea usuarios ni cambia roles.
- Tests E2E primero, solo TEST_DB_*. Documentalo en db/README.md. npm test.
- Fila T9c + Log + Engram, handoff en odd/handoffs/t9c-review.md. Sin commit ni push. No toques CLAUDE.md. No empieces T10."

**Alcance leído:** fila `T9c`, spec `S14`. `T10` **no** empezada.

## Qué se hizo

| Archivo | Cambio |
|---|---|
| `scripts/reset-password.js` | nuevo: CLI de emergencia (S14), patrón de prompts idéntico a `create-admin` |
| `package.json` | +script `"reset-password": "node scripts/reset-password.js"` |
| `test/reset-password.test.js` | nuevo: 6 tests E2E con `TEST_DB_*` |
| `db/README.md` | §8 nueva "Emergency password reset" + `test/reset-password.test.js` en la lista de tests `TEST_DB_*` |

## Decisiones a revisar

1. **Chequeo de existencia antes de pedir la contraseña.** `findByEmail` corre apenas se responde el email; si no existe, `exit 1` con `no user with that email` y el CLI **no** llega a pedir la contraseña temporal. En una emergencia no tiene sentido escribir una contraseña para una cuenta inexistente. (Spec no fija el orden; es una decisión de UX.)
2. **Reutiliza `setTemporaryPassword` y `revokeAllForUser` ya existentes** (`userRepository` §5.5, `sessionRepository` §5.2): el CLI no escribe SQL propio. `setTemporaryPassword` deja `must_change_password = 1` y **no** toca `password_changed_at` (el usuario aún no eligió su contraseña).
3. **Mismo patrón de prompts que `create-admin`** (cola de líneas para stdin pipeado, input oculto sin `trim()`, email visible con `trim()`); código duplicado a propósito en vez de extraer a un módulo compartido, para no tocar `create-admin.js` fuera del alcance de T9c.
4. **El CLI ignora argv por completo**: sin argumentos visibles; el test "never accepts the password as a command-line argument" pinna que con stdin cerrado falla sin tocar la DB.

## Evidencia

- **RED**: 5 tests rojos — el script no existía (los 5 que ejercitan el CLI fallan; el 6º pasa vacío porque el child salía con código 1 igual).
- **GREEN**: `node --test test/reset-password.test.js` → 6/6.
- **`npm test`** (`node --test --test-concurrency=1 "test/**/*.test.js"`) → **112/112 con `TEST_DB_*`** (Docker 3307; 6 tests nuevos sobre los 106 de T9b, **0 skips**, 0 fallos).
- Cobertura de los 6 E2E: happy path (hash nuevo verificado, `must_change_password = 1`, 2 sesiones revocadas, rol `qa_engineer` intacto, 0 admins creados), contraseña con espacios exactos (sin `trim()`), email inexistente (exit 1 + sin cambios), política (`password_too_short`, hash y sesión intactos), mismatch, CLI sin stdin (no cuelga).
- Riesgo: **item 2 (credenciales)** → corresponde verificación/revisión acorde.

## Estado del repositorio

- **Sin commit, sin push** (instrucción explícita; el commit de cierre llega con la aprobación). `git status`: modificados `package.json`, `db/README.md`, `odd/tasks/login-authentication.md`; nuevos `scripts/reset-password.js`, `test/reset-password.test.js`, `odd/handoffs/t9c-review.md`. (Además `CLAUDE.md` sin trackear, sin tocar.)
- `CLAUDE.md` **no** se tocó.
- Plan actualizado: fila `T9c` (estado + evidencia), línea de estado general y `L32`/`L33` en el `## Log`.
- **Cierre (L33):** aprobada por Claude Code (112/112).
- Commit de cierre: `feat: add emergency reset-password CLI (T9c)`, **sin push**, solo archivos de T9c (`CLAUDE.md` excluido).
- Siguiente: `T10` (hardening cloud), pendiente de autorización.
