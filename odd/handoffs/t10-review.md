# T10 — Hardening de producción + documentación de despliegue (handoff de revisión)

**Autorización (L34, 2026-10-26):** "Autorizo T10 de odd/tasks/login-authentication.md. Leé la fila T10, S8, L27 y diseño §5.6 y §8.2.
- loadConfig en producción: exigir TRUST_PROXY=1, DB_PASSWORD no vacío y APP_ORIGIN https; puertos con validación estricta.
- HTTPS: redirección y HSTS en producción usando X-Forwarded-Proto (Caddy es el proxy).
- pool.js: si fallan los SET de sesión, descartar esa conexión.
- migrate.js: GET_LOCK para evitar dos migraciones simultáneas.
- docker-compose.yml (producción): agregar servicio db (mariadb:10.11, volumen persistente, SIN ports, healthcheck, utf8mb4_unicode_ci); app con env_file .env.production (ignorado por git) y depends_on db service_healthy. .dockerignore: excluir test/, odd/, docs/, db/docker/, .env*.
- Documentar en README + db/README.md el despliegue: crear usuarios qa_app y qa_migrator (sin DROP), backup diario con mysqldump fuera del contenedor, npm run migrate y create-admin dentro del contenedor app, verificación con curl sin cookie (401).
- Test primero, solo TEST_DB_*. npm test.
- Fila T10 + Log + Engram, handoff en odd/handoffs/t10-review.md. Sin commit ni push. No toques CLAUDE.md. No despliegues nada."

**Correcciones (L35, 2026-10-27, literal):** "Correcciones T10 (sin más cambios):
1. pool.js: enviá los dos SET de sesión juntos (Promise.all) para que queden en cola antes de cualquier consulta; si falla alguno, destroy(). Test.
2. Secretos: la base lee MARIADB_ROOT_PASSWORD de .env.db (git-ignored, excluido por .dockerignore); la app no la recibe. Actualizá db/README.md.
3. (opcional) httpsRedirect: armá la URL desde APP_ORIGIN, no desde Host.
Estrategia de PR: exception-ok (un solo PR a master, revisión por commit). Registralo en el Log.
npm test y commiteá T10. Sin push. No toques CLAUDE.md."

**Alcance leído:** fila `T10`, spec `S8`, `L27`, diseño `docs/auth/auth-architecture.md` §5.6 y §8.2 (más §6.1 para el orden del middleware y §4 para los `SET` de sesión).

## Qué se hizo

| Archivo | Cambio |
|---|---|
| `src/config/env.js` | `parsePort` estricto para `PORT` y `DB_PORT` (`^\d+$`, 1–65535) + `assertProductionConfig` solo con `NODE_ENV=production` (TRUST_PROXY===1, `DB_PASSWORD` no vacío, `APP_ORIGIN` `https:`) |
| `src/middleware/httpsRedirect.js` | nuevo: en producción emite HSTS (`max-age=31536000`) y `res.redirect(308, …)` cuando `!req.secure`, con la URL armada desde `APP_ORIGIN` (`new URL(originalUrl, appOrigin)`, L35) y **no** desde el `Host` (header del cliente); firma `httpsRedirect(nodeEnv, appOrigin)`; fuera de producción es no-op |
| `src/app.js` | paso §6.1: `trust proxy` → `httpsRedirect(config.nodeEnv, config.appOrigin)` → `securityHeaders` |
| `src/db/pool.js` | nuevo export `applySessionSettings`: los dos `SET` se encolan **juntos con `Promise.all`** en el mismo tick (L35, ninguna consulta de borrower se cuele entre ellos); si falla cualquiera, `connection.destroy()` (nunca rechaza) |
| `scripts/migrate.js` | nuevo export `migrationLockName(dbName)`; `runMigrations` adquiere `SELECT GET_LOCK(?, 0)` antes de cualquier DDL y libera en `finally` |
| `test/env.test.js` | +4 tests (producción válida, reglas de producción, desarrollo relajado, puertos malformados/fuera de rango) |
| `test/httpsRedirect.test.js` | nuevo: 3 tests (308+HSTS con método/query **con `Location` exacta desde `APP_ORIGIN` con Host distinto**, 200+HSTS con `X-Forwarded-Proto: https`, no-op en development) |
| `test/pool.test.js` | nuevo: 3 tests con fake connection (orden de los `SET`; `destroy()` si falla el 1º o el 2º; **cola síncrona: ambos `SET` encolados sin resolver ninguno**, L35) |
| `test/migrate.test.js` | +1 test: otro session retiene el lock → `runMigrations` rechaza sin crear `schema_migrations`; al liberar, aplica las 3 migraciones |
| `docker-compose.yml` | servicio `db` (mariadb:10.11, volumen `db_data`, **sin `ports`**, healthcheck `healthcheck.sh --connect --innodb_initialized`, utf8mb4/utf8mb4_unicode_ci) con **`env_file: .env.db`** (solo `MARIADB_ROOT_PASSWORD`, L35) + `app` con `env_file: .env.production` (sin root password) y `depends_on: db: service_healthy`; `caddy` intacto |
| `.dockerignore` | excluye `test/`, `odd/`, `docs/`, `db/docker/`, `.env*`, `*.md` de raíz, coverage, etc. |
| `db/README.md` | §7 reescrita: **§7.1 con los dos archivos** (`.env.production` de la app sin root + `.env.db` solo con `MARIADB_ROOT_PASSWORD`, L35), SQL de usuarios (`qa_app` DML; `qa_migrator` con CREATE/INDEX/ALTER/REFERENCES **sin `DROP`**), `exec app npm run migrate`/`create-admin`, backup `mysqldump` por `exec -T` fuera del contenedor, verificación con `curl`, rollback |
| `README.md` | "Deployment with Docker" a 13 pasos: pasos 4–8 nuevos (paso 4 con **`.env.production` + `.env.db` separados**), usuarios, build+migrate+create-admin, verificación 401/302, backup diario y renumeración del resto |

## Decisiones a revisar

1. **Redirect 308 (no 301/302).** Preserva método y body (POST/PUT reintentan contra HTTPS). El diseño solo dice "redirección a HTTPS".
2. **HSTS `max-age=31536000` sin `includeSubDomains`.** El diseño no fija el valor; se eligió el mínimo conservador para no comprometer subdominios que no estén en el alcance.
3. **El 308 sale antes de `securityHeaders`** (orden literal §6.1: trust proxy → redirect → headers). Esa respuesta 308 **no** lleva `Cache-Control: no-store` (sí lleva HSTS): es la excepción que acepta el orden del diseño. Si preferís el orden contrario, es un cambio de una línea en `app.js` más su test.
4. **`GET_LOCK` con timeout 0.** La segunda migración falla de inmediato con mensaje claro en vez de encolarse; el lock es por servidor, por eso el nombre incluye `db.name` y va limitado a 64 chars.
5. **Ambos servicios leían el mismo `.env.production`** → la app recibía también `MARIADB_ROOT_PASSWORD`. **Resuelta en L35: ahora dos archivos** — `.env.db` solo para `db` (root) y `.env.production` para la app (sin root). `.gitignore` (`.env.*`) y `.dockerignore` (`.env*`) ya cubrían `.env.db`; validado con `docker compose config --format json` (root presente en `db`, **ausente en `app`**) y `git check-ignore`. Tradeoff asumido: dos fuentes de verdad en el servidor, documentadas en `db/README.md` §7.1.
6. **`migrate` y `create-admin` corren dentro del contenedor app** (`docker compose exec app …`), como pidió la usuaria: usan `qa_migrator`/`qa_app` de `MIGRATE_DB_*`/`DB_*`, nunca el root. El dump de backup va del lado `db` con el root y se redirige al host (`exec -T`), fuera del volumen.
7. **El servidor db no publica puertos en el host** (solo red interna del compose); el `init` de usuarios de `db/docker/` **no** se monta en producción (los usuarios se crean a mano, §7.2, sin `DROP`). Local (`docker-compose.dev.yml`) no cambió.
8. **`*.md` en `.dockerignore`** solo cubre la raíz (`filepath.Match` no cruza `/`): `db/README.md` sigue entrando al contexto. Es el comportamiento preexistente del patrón, no se tocó para no ampliar alcance.

## Evidencia

- **RED**: 5 fallos — 2 en `test/env.test.js` (la producción aceptaba sin `TRUST_PROXY`; puertos `4000abc`/`0`/`65536` aceptados) + 3 archivos que ni cargaban (`httpsRedirect.test.js`, `pool.test.js`, `migrate.test.js` por importar `migrationLockName`).
- **GREEN**: `node --test --test-concurrency=1 "test/**/*.test.js"` → **122/122 con `TEST_DB_*`** (Docker 3307; 10 tests nuevos: 4 env + 3 HTTPS + 2 pool + 1 migrate, **0 skips**, 0 fallos). `npm test` no corre en esta terminal por la política de PowerShell del entorno (no del repo); el comando anterior es el que define.
- **Correcciones L35**: RED **2 fallos** (cola síncrona de los `SET`: `1 !== 2`; `Location` seguía el Host en vez de `APP_ORIGIN`) → GREEN → **suite final vía `npm.cmd test`: 123/123 con `TEST_DB_*`, 0 skips** (122 + 1 test nuevo de pool).
- **Probe en vivo con `NODE_ENV=production TRUST_PROXY=1 APP_ORIGIN=https://localhost:4100`** (server temporal en el puerto 4100, ya detenido):
  - `GET http://localhost:4100/` → **308** + `Location: https://localhost:4100/` + `Strict-Transport-Security: max-age=31536000`.
  - `GET /api/auth/me` con `X-Forwarded-Proto: https` y sin cookie → **401** `unauthenticated` + HSTS + `no-store` + headers de seguridad.
  - `GET /` con `X-Forwarded-Proto: https` sin sesión → **302** a `/login.html` + HSTS.
- **Compose**: `docker compose config --format json` válido con stubs `.env.production` + `.env.db` de prueba (creados y borrados; los archivos reales no existen y no se creó): `MARIADB_ROOT_PASSWORD` en `db` desde `.env.db` y **ausente en `app`**. `docker build --check .` sin warnings; un build temporal con busybox confirmó que el contexto **no** incluye `test/`, `odd/`, `docs/`, `db/docker/` ni `.env*` (imagen temporal eliminada).
- **Verificación documentada** (README paso 7 / db/README §7.5): `curl -i https://…/api/auth/me` → 401 sin cookie; `/` → 302 a `/login.html`.
- Riesgo: **item 5 (delivery/entorno) e item 6 (sin test que cubra el runtime Docker real)** → la revisión y la prueba en staging antes del deploy real son la mitigación; nada se desplegó.

## Estado del repositorio

- **Commit de cierre: `feat: harden production config and deployment (T10)`** (incluye este handoff y el plan; **sin push**). `git status` del cierre: modificados `.dockerignore`, `README.md`, `db/README.md`, `docker-compose.yml`, `scripts/migrate.js`, `src/app.js`, `src/config/env.js`, `src/db/pool.js`, `test/env.test.js`, `test/migrate.test.js`, `odd/tasks/login-authentication.md`; nuevos `src/middleware/httpsRedirect.js`, `test/httpsRedirect.test.js`, `test/pool.test.js`, `odd/handoffs/t10-review.md`. (Además `CLAUDE.md` sin trackear, sin tocar.)
- `CLAUDE.md` **no** se tocó. **No se desplegó nada**: ningún `docker compose up` del stack de producción; el único servicio usado fue la base local de desarrollo en 3307.
- Plan actualizado: encabezado (estrategia `exception-ok`), fila `T10` (alcance + estado + evidencia L34+L35), línea de estado general, `L34` y `L35` en el `## Log`.
- **Estrategia de PR (resuelta en L35): `exception-ok`** — un solo PR a `master`, revisión por commit (cierre de lo diferido en L31).
- Siguiente: revisión de Claude Code sobre este handoff; luego `T11` (pendiente de autorización). Sin push.
