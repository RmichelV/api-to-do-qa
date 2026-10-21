# Handoff de revisión — T6 (cambio de contraseña por API)

Para: **Claude Code** (revisor).
Feature: `login-authentication` · Rama: `feature/login-authentication`.
Plan: `odd/tasks/login-authentication.md` (T6, specs S3, S4, S6) · Diseño: `docs/auth/auth-architecture.md` §5.1, §5.2, §5.5, §7.1.
Runner: `node --test` · Base de tests: Docker MariaDB en 3307 (`TEST_DB_*` de `.env`, `api_to_do_qa_test`).
Commiteado en `feature/login-authentication` al cierre (incluye las correcciones de L19; sin push). T7 no empezó.

## Alcance de T6 (lo que se pidió)

> "**Cambio de contraseña (API)**: endpoint, revocación de las otras sesiones, `requirePasswordChanged`
> y flujo de `must_change_password`."

Fuera de alcance a propósito: pantalla `change-password.html` (T7), `requireAuth`/allow-list global (T8),
API admin y resets con `must_change_password=1` (T9).

## Cambios realizados

| Archivo | Estado | Qué hace |
|---|---|---|
| `src/middleware/requirePasswordChanged.js` | nuevo | §5.5: allow-list exacta `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout`, `GET /change-password.html` y — tras L19 — los assets de esa pantalla: `GET /styles.css` y `GET /change-password.js`. Resto de API → `403 { error: "password_change_required" }`; resto de páginas → `302 /change-password.html`. Sin sesión o flag en 0 → pasa (el 401 es de `requireAuth`, T8). |
| `src/app.js` | modificado | `requirePasswordChanged()` montado tras `sessionMiddleware`, dentro del branch `config && pool` (S12: los smoke tests de QA siguen intactos). |
| `src/routes/authRoutes.js` | modificado | `POST /change-password` (§7.1), bajo el `originCheck` de `/api/auth`. |
| `src/controllers/authController.js` | modificado | `changePassword`: exige `req.user` + `req.session` (401), pasa userId/sesión/cookie/**ip** al servicio (ip: L19, rate limit), setea cookie rotada solo si hubo rotación, responde 204. |
| `src/services/authService.js` | modificado | `changePassword` (ver flujo abajo) + `assertWithinRateLimit` extraída del login (L19): **misma función, mismos caps** (5 email / 20 IP en 15 min → 429) para login y change-password. |
| `src/repositories/userRepository.js` | modificado | `updatePassword`: hash nuevo + `must_change_password=0` + `password_changed_at` + `updated_at` en un UPDATE. |
| `src/repositories/sessionRepository.js` | modificado | `revokeAllForUser({ userId, exceptId })`: revoca todas las sesiones vivas del usuario, opcionalmente excepto una (la que se rota). |
| `test/requirePasswordChanged.test.js` | nuevo | 8 unit (sin DB): allow-list completa, 403 en API (incluye re-login y rutas QA), 302 en páginas, passthrough sin sesión/flag 0. |
| `test/changePassword.test.js` | nuevo | 10 integración (HTTP real + DB, solo `TEST_DB_*`). |
| `odd/tasks/login-authentication.md` | modificado | Fila T6, Log L18, cabecera de estado. |

## Flujo de `POST /api/auth/change-password` (§7.1 + §5.1 + §5.2)

1. Sesión exigida (401 `unauthenticated`) y Origin validado por `originCheck` (403).
2. Body: ambos campos string no vacíos → si no, 400 `validation_error`.
3. **Rate limit §5.4 antes de verificar** (L19): 5 fallos por email o 20 por IP en 15 min → 429
   `too_many_attempts`, con la misma función que el login (`assertWithinRateLimit`).
4. **Verifica la contraseña actual primero** (401 `invalid_credentials`) — sin feedback de política a
   quien no probó la actual; **cada fallo queda registrado en `login_attempts`** (`succeeded=0`).
5. `validatePolicy(new, current)` → 400 con `password_same_as_current` / `password_too_short` / `password_too_long` en el message.
6. `users`: hash nuevo (scrypt), `must_change_password=0`, `password_changed_at=now`.
7. Revoca **todas** las otras sesiones del usuario (`revokeAllForUser` menos la actual).
8. **Rota la sesión actual con CAS** → cookie nueva con `Max-Age` = tiempo restante hasta `expires_at` (**la expiración de 7 días nunca se extiende**). Si se pierde la carrera de rotación (gracia de 60 s concurrente), el cambio ya quedó aplicado y la cookie vieja sigue siendo válida dentro de la gracia.
9. 204 sin body.

## Resultado de pruebas

```
con TEST_DB_* (Docker 3307, qa_migrator sobre api_to_do_qa_test)  →  77 passed, 0 failed, 0 skipped
RED antes de implementar:  ERR_MODULE_NOT_FOUND (requirePasswordChanged.js) + 404 en /api/auth/change-password
RED de las correcciones (L19): 3 tests — unit de assets, /styles.css con flag activo (302 vs 200 esperado) y 429 (recibía 204)
```

Cobertura nueva: 9 unit (`requirePasswordChanged`, incl. los dos assets de la allow-list) + 11 integración
(401/403 de entrada; 401 password actual incorrecta sin tocar nada; 400 body; política misma y <12; happy
path con hash/flag/rotación/`expires_at` sin extender; revocación de la otra sesión → 401; §5.5 end-to-end:
QA → 403, re-login → 403, página → 302, `/styles.css` → 200 con flag activo, el cambio levanta el gate;
logout disponible; **5 fallos de la actual → 429 y caps compartidos con login**; cambio voluntario con
flag ya en 0). Los 57 tests de T5 siguen verdes (el login reescrito sobre `assertWithinRateLimit` los
mantuvo en verde sin tocarlos). **Default seguro no re-medido**: el `.env` actual ya incluye `TEST_DB_*`
(commit Docker `a2a7840` de la usuaria); el skip sigue siendo el patrón L10 (sin fallback a `DB_*`).

## Decisiones técnicas para tu revisión (candidatas a blocking)

1. **Verificar la contraseña actual ANTES de la política.** El feedback de política solo llega a quien
   ya probó la contraseña actual con sesión válida. Alternativa (política primero) descartada: da info a
   un cookie robado antes de comprobar posesión.
2. **`requirePasswordChanged` montado globalmente en T6** (tras `sessionMiddleware`, branch config+pool),
   incluyendo rutas QA. Literal de §5.5: "every other API returns 403". Las rutas QA sin sesión siguen
   respondiendo igual (sin `req.user` el gate pasa) — el 401 de sesión llega en T8 con `requireAuth`.
3. **Re-login (`POST /api/auth/login`) bloqueado con 403 mientras dure el flag**, porque la allow-list de
   §5.5 no lo incluye. Decisión literal; si preferís permitirlo, es un cambio de una línea + test.
4. **La rotación de la sesión actual aplica la gracia estándar de 60 s** al token viejo (es la misma
   rotación de §5.2, no un mecanismo aparte). `previous_token_hash` queda seteado y el viejo es válido
   60 s — comportamiento probado por la naturaleza CAS del update.
5. **CAS de rotación perdido → 204 igual, sin cookie nueva.** El password ya cambió y las otras sesiones
   quedaron revocadas; no se puede re-enviar en claro un token que otra petición rotó. Cubierto por la gracia.
6. **`/change-password.html` en la allow-list desde T6** aunque la página recién existe en T7: si un flag
   llegara a ponerse en 1 antes de T7 (solo posible vía T9), el 302 apunta a la página correcta.
7. **Caps de §5.4 compartidos entre login y change-password** (L19): el límite usa la misma tabla
   `login_attempts`, la misma ventana (15 min) y la misma función `assertWithinRateLimit` para ambos
   flujos. Consecuencia a validar: 5 fallos de la contraseña actual bloquean también el login de ese
   usuario (429), y viceversa — es la lectura más estricta de "el mismo límite que el login".

## Riesgos y pendientes

- **Risk T6 (item 1+2+3):** credenciales y sesiones. La contraseña actual se verifica con `verify` (scrypt
  + `timingSafeEqual`); se revocan todas las sesiones ajenas en el mismo flujo; solo hashes en DB.
- El gate redirige a `/change-password.html` que todavía no existe (T7): hoy daría 404 **solo** si un
  usuario con `must_change_password=1` pidiera una página. Nadie puede tener ese flag en 1 todavía en
  producción: `create-admin` lo crea en 0 y los resets son T9.
- Suite completa ~100 s con `TEST_DB_*` (scrypt a propósito). `--test-concurrency=1` sigue activo (T4).
- Rama 3 commits sin push: `e35712e` (T5), `a2a7840` (Docker, de la usuaria) y el commit de T6 de este
  cierre. T7 no empezó.
- Pendiente previo no bloqueante: `SELECT VERSION();` en phpMyAdmin de Hostinger (§8.1).

## Qué se pide revisar

1. Que T6 cubra S3, S4 y S6 sin salirse del alcance (S3 a nivel API; la pantalla es T7).
2. `requirePasswordChanged`: allow-list exacta de §5.5, 403 vs 302 y montaje global.
3. `changePassword`: orden del flujo, revocación de las otras sesiones, rotación CAS y `expires_at` intacto.
4. Las 7 decisiones técnicas de arriba (especialmente 2, 3 y 7).
5. Que los tests de T5/QA siguen intactos y que S12 no se tocó.

T7 queda pendiente de autorización explícita. Sin merge, rebase, PR ni cambios en `main`.
