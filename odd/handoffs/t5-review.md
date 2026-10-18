# Handoff de revisión — T5 (sesiones y login por API)

Para: **Claude Code** (revisor).
Feature: `login-authentication` · Rama: `feature/login-authentication`.
Plan: `odd/tasks/login-authentication.md` (T5, specs S2, S4, S6) · Diseño: `docs/auth/auth-architecture.md` §5.2–§5.6, §7.1.
Runner: `node --test`. Sin commits todavía: todo está en el working tree.

## Alcance de T5 (lo que se pidió)

> "**Sesiones y login por API**: `sessionRepository`, `loginAttemptRepository`, `authService`,
> `sessionMiddleware` (rotación y expiración), `originCheck`, `securityHeaders`, `errorHandler`;
> endpoints `login`, `logout` y `me`. Las rutas QA **todavía sin proteger**."

Fuera de alcance (no implementado a propósito): cambio de contraseña y `requirePasswordChanged`
(T6), pantallas (T7), `requireAuth` global y allow-list (T8), API admin (T9).

## Cambios realizados

| Archivo | Estado | Qué hace |
|---|---|---|
| `src/services/sessionPolicy.js` | nuevo | §5.2 como funciones puras con reloj inyectado: `ROTATION_AFTER=24h`, `ROTATION_GRACE=60s`, `TOUCH_INTERVAL=5min`, `isExpired` (expirada **o** revocada), `needsRotation`, `isPreviousTokenValid`, `shouldTouchLastSeen`, `sessionMaxAgeSeconds`. |
| `src/utils/cookies.js` | nuevo | `parseCookies` a mano (sin cookie-parser: única dependencia nueva sigue siendo mysql2, D2), `buildSessionCookie` (`qa_session`, `Max-Age`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` solo en producción) y `buildClearCookie` (`Max-Age=0`). |
| `src/utils/errors.js` | nuevo | `AppError(status, code, message)`: el formato uniforme `{ error, message }` del diseño §7. |
| `src/repositories/sessionRepository.js` | nuevo | SQL plano con pool explícito. **Solo hashes SHA-256** del token (BINARY(32)); el token en claro vive únicamente en la cookie. `create`, `findByTokenHash`, `findByPreviousTokenHash`, `rotate` con **CAS** (`WHERE id = ? AND token_hash = ? AND revoked_at IS NULL`; dos peticiones concurrentes no pueden rotar dos veces), `touchLastSeen`, `revoke` idempotente (`COALESCE`), `purgeExpired` (expiradas o revocadas de más de 7 días, oportunista). |
| `src/repositories/loginAttemptRepository.js` | nuevo | `record`, `countFailed` (por email en ventana), `countFailedByIp`, `purgeOlderThan` (>24 h). Log en MySQL: sobrevive reinicios e instancias (D8). |
| `src/services/authService.js` | nuevo | §5.4: valida body (400 `validation_error`) → normaliza email → purge oportunista (**un error de purge nunca bloquea el login**) → rate limit **antes** de verificar (5 fallas por email o 20 por IP en 15 min → 429 `too_many_attempts`) → `verify` o `verifyDummy` si el usuario no existe/inactivo (timing uniforme) → registra el intento → **si la petición traía una cookie con sesión viva, la revoca** (ajuste L16: el re-login deja una sola sesión activa por navegador) → crea sesión (UUID, hash, expiración fija de 7 días) → `last_login_at`. Errores: 401 `invalid_credentials` genérico idéntico para password incorrecta y email inexistente. `logout(token)` revoca por hash actual o previo. |
| `src/middleware/sessionMiddleware.js` | nuevo | §5.2: **nunca bloquea**; solo adjunta `req.user`/`req.session` si la cookie trae una sesión viva. Rotación a las 24 h con CAS (si se pierde la carrera, continúa sin cookie nueva: la gracia cubre al perdedor); el token previo se acepta 60 s **sin** re-setear cookie; `last_seen_at` se toca como máximo cada 5 min; sesión expirada/revocada/inactiva → sin `req.user` (el 401 lo emite el endpoint protegido, T8 aplica `requireAuth`). |
| `src/middleware/originCheck.js` | nuevo | §5.3: en POST/PUT/PATCH/DELETE, `Origin` (o el origin de `Referer`) debe ser exactamente `APP_ORIGIN`, si no 403 `invalid_origin`. Montado **solo en `/api/auth`** por ahora; la aplicación global queda en T8. |
| `src/middleware/securityHeaders.js` | nuevo | §5.6: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, y `Cache-Control: no-store` en `/api/*`. |
| `src/middleware/errorHandler.js` | nuevo | JSON uniforme `{ error, message }`; `AppError` → su status; body JSON malformado → 400 `validation_error`; resto → 500 `internal_error` **genérico sin stack**. |
| `src/controllers/authController.js` | nuevo | Adaptador delgado (§4.5): login → 200 `{ user }` + Set-Cookie (pasa además el token de la cookie actual al servicio); logout → 204 idempotente + cookie limpia; me → 200 `{ user }` o 401 `unauthenticated`. |
| `src/routes/authRoutes.js` | nuevo | `POST /login`, `POST /logout`, `GET /me` (§7.1), con `sessionDays` y `secure` del config. |
| `src/app.js` | modificado | `createApp({ config, pool } = {})`: `securityHeaders` global; auth (sessionMiddleware + originCheck + rutas) **solo cuando llegan config y pool** — los smoke tests de QA siguen llamando `createApp()` sin cambiar (S12); `errorHandler` al final. |
| `src/server.js` | modificado | Carga `loadConfig()` + `createPool()` y los pasa a `createApp` (§9); cierra el pool en SIGINT/SIGTERM. **Nuevo comportamiento**: sin env completa, el server arranca fallando con el mensaje claro de `loadConfig` (antes arrancaba y fallaba después). |
| `test/sessionPolicy.test.js` | nuevo | 6 unit: constantes exactas, `isExpired` (por tiempo y por revoked), `needsRotation` en el borde de 24 h, gracia de 60 s en el borde, touch a los 5 min, `sessionMaxAgeSeconds` (positivo, cero y negativo). |
| `test/cookies.test.js` | nuevo | 4 unit: parse de varios/rotos/sin header, cookie con flags (`Secure` solo cuando se pide), clear-cookie. |
| `test/originCheck.test.js` | nuevo | 5 unit: GET safe pasa sin Origin, POST con Origin exacto pasa, sin Origin/Referer → 403, origen ajeno → 403 (Referer también). |
| `test/authApi.test.js` | nuevo | 16 integración contra servidor HTTP real (`createApp({config,pool}).listen(0)` + `fetch`, §10), solo `TEST_DB_*`. |
| `odd/tasks/login-authentication.md` | modificado | Fila T5, Log L15, cabecera de estado. |

## Resultado de pruebas

```
con TEST_DB_* (qa_migrator sobre api_to_do_qa_test)  →  57 passed, 0 failed, 0 skipped
sin TEST_DB_* (default seguro)                       →  30 passed, 0 failed, 27 skipped
```

RED observado antes de implementar: los 15 tests de `authApi.test.js` fallaban con 404 en
`/api/auth/login` (endpoint inexistente). Cobertura nueva: 15 unit + 16 integración.

La integración cubre: login 200 con cookie flags correctos y **solo el hash** en
`user_sessions` (comparado byte a byte contra `sha256(token)`); 401 genérico idéntico para
password incorrecta e email inexistente (+ filas en `login_attempts`); 400 por body inválido;
429 por límite de email (5) **y** de IP (20, inyectadas vía SQL con el IP real que registró el
server); `me` 200/401; usuario inactivo → 401; **re-login con cookie viva revoca la sesión
anterior (L16)**; logout 204 idempotente, cookie limpia y `revoked_at` en DB; rotación a las
24 h con token nuevo distinto, hash previo preservado, aceptación del viejo dentro de los 60 s
**sin** Set-Cookie, y rechazo pasada la gracia; sesión expirada → 401; Origin ausente/ajeno →
403; headers §5.6; `last_seen_at` refrescado después de 6 min.

## Decisiones técnicas para tu revisión (candidatas a blocking)

1. **`createApp({ config, pool })` opcional.** El auth wiring solo se instala con config y pool;
   sin ellos la app es la vieja (QA sin tocar, S12). Alternativa descartada: inyectar siempre y
   romper los smoke tests. T8 reemplazará esto por el wiring completo de §6.
2. **originCheck solo en `/api/auth` en T5.** Aplicarlo globalmente ahora rompería los smoke
   tests de QA (hacen POST sin Origin). El diseño §6 lo pide global; queda para T8 junto con
   `requireAuth`. Riesgo acotado: las rutas QA siguen públicas hasta T8 (ya era el estado).
3. **Rate limit ANTES de verificar la contraseña** (5 email / 20 IP en 15 min → 429): ahorra
   CPU scrypt bajo ataque. Un intento con la password correcta devuelve 429 si el límite ya se
   alcanzó — comportamiento probado a propósito.
4. **La rotación usa CAS en el UPDATE.** Dos peticiones concurrentes tras 24 h: solo una rota;
   la otra continúa con su token viejo, que queda como `previous` y es válido por la gracia.
   Se pierde la carrera → sin Set-Cookie nuevo (no se puede re-enviar el token en claro ajeno).
5. **`server.js` ahora valida el env al arranque** (`loadConfig`): falla rápido y con mensaje
   claro en vez de morir más tarde. Cambio de comportamiento operativo, alineado con §9.
6. **`securityHeaders` global** agrega headers a todas las respuestas (antes no había ninguno):
   es aditivo; el `no-store` solo aplica a `/api/*`.
7. **`errorHandler` al final de la cadena** también captura errores no manejados de las rutas
   QA (antes Express devolvía su HTML de error por defecto; ahora JSON `internal_error`). Los
   caminos de éxito de QA no cambian (S12).

## Riesgos y pendientes

- **Risk T5 (item 1+3):** sesiones y credenciales. Tokens con `randomBytes(32)`, solo hashes
  SHA-256 en DB, cookie HttpOnly/SameSite=Lax (+Secure en prod), rotación con CAS, revocación
  inmediata, rate limit persistente en MySQL.
- El hash de sesión es un SHA-256 simple (no scrypt): el token tiene 256 bits de entropía
  aleatoria, no es derivable, y el diseño §5.2 lo pide así. Correcto; no confundir con las
  contraseñas (esas van con scrypt, T4).
- `last_login_at` y `rotated_at` se escriben con el `now` de Node (pool en UTC, sin skew
  local). Los tests de rotación/touch manipulan los timestamps vía SQL con `UTC_TIMESTAMP(3)`.
- La usuaria ya creó su admin a mano en la base de desarrollo `api_to_do_qa` (fuera de los
  tests, como pidió). Los tests solo tocan `api_to_do_qa_test` (L10 intacto).
- Suite completa: ~56 s con `TEST_DB_*` (scrypt a propósito). `--test-concurrency=1` sigue
  activo por la base compartida (T4).
- Un fallo aislado de un test de CLI E2E se observó una vez en una corrida previa (stdin
  timing); no se reprodujo en corridas siguientes. Vigilar en T5+.
- Pendiente previo no bloqueante: `SELECT VERSION();` en phpMyAdmin de Hostinger (§8.1).

## Qué se pide revisar

1. Que T5 cubra S2, S4 y S6 sin salirse del alcance (S2 solo a nivel API; `login.html` es T7;
   proteger rutas QA es T8).
2. `sessionPolicy` + `sessionMiddleware`: política completa §5.2 (expiración fija, rotación,
   gracia, touch, CAS) y que nunca bloquean por sí solos.
3. `authService`: orden del flujo §5.4 (rate limit antes de verify, purge no bloqueante,
   401 genérico idéntico, intentos registrados).
4. Cookies y headers: flags exactos, `Secure` condicionado a producción, `no-store` en API.
5. `originCheck`: métodos cubiertos, comparación exacta y fallback a Referer.
6. Las 7 decisiones técnicas de arriba (especialmente 1, 2 y 3).
7. Que las rutas QA siguen intactas y sin protección (S12) y que `server.js` con env real
   arranca y sirve igual que antes.

Tras el **aprobado**, se hará un commit Conventional en `feature/login-authentication` y push
solo a esa rama. Sin merge, rebase, PR ni cambios en `main`. T6 queda pendiente de
autorización explícita.
