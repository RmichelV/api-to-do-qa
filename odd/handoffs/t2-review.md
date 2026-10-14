# Handoff de revisión — T2 (config y conexión MySQL)

Para: **Claude Code** (revisor).
Feature: `login-authentication` · Rama: `feature/login-authentication`.
Plan: `odd/tasks/login-authentication.md` (T2, specs S7 y S8) · Diseño: `docs/auth/auth-architecture.md`.
Runner: `node --test`. Sin commits todavía: todo está en el working tree.

## Alcance de T2 (lo que se pidió)

> "Config y conexión MySQL: agregar `mysql2`, `src/config/env.js`, `src/db/pool.js`
> (UTC, modo estricto, `multipleStatements: false`), `.env.example`, `db/README.md`
> (motor local con XAMPP o Docker, usuarios `qa_app` y `qa_migrator`).
> Sin tablas todavía."

Fuera de alcance (no implementado a propósito): tablas, migraciones, usuarios, login, sesiones,
cualquier endpoint nuevo, cambios en los routers o servicios QA.

## Cambios realizados

| Archivo | Estado | Qué hace |
|---|---|---|
| `package.json` / `package-lock.json` | modificado | `mysql2@3.24.6` como única dependencia nueva. `npm audit --omit=dev` → 0 vulnerabilidades. |
| `src/config/env.js` | nuevo | `loadConfig()`: carga `.env` con `process.loadEnvFile()` solo si existe (sin dotenv), valida las 7 variables requeridas, tira error claro si falta alguna, congela el objeto. Opcionales con default: `PORT`, `DB_SSL`, `DB_CONNECTION_LIMIT`, `SESSION_DAYS`, `TRUST_PROXY`. `DB_PASSWORD=""` cuenta como definido (XAMPP root local); solo `undefined` es faltante. |
| `src/db/pool.js` | nuevo | `createPool()`: `utf8mb4`, `timezone: 'Z'`, `multipleStatements: false`, `connectionLimit`. Por cada conexión nueva: `SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'` y `SET SESSION time_zone = '+00:00'` (diseño §4: `DATETIME(3)` en UTC). |
| `db/README.md` | nuevo | Setup local (XAMPP/Docker) y Hostinger: crear bases vacías, usuarios `qa_app` (solo DML) y `qa_migrator` (+DDL), plantilla `.env`, cómo verificar la conexión, pasos de integración §8.2. |
| `.env.example` | nuevo | Plantilla sin credenciales (`DB_PASSWORD=your-local-password`). Commiteable (fuera de `.gitignore`). |
| `test/env.test.js` | nuevo | Unit tests de `loadConfig`: defaults, congelado, lista todas las faltantes, rechaza puerto no numérico y booleano inválido. |
| `test/db.test.js` | nuevo | Integración real: `SELECT 1`, `sql_mode` estricto, `time_zone +00:00`. **Lee solo `TEST_DB_HOST/NAME/USER` y se salta si faltan — sin fallback a `DB_*`** (ver "Corrección pre-T3"). |
| `src/app.js` | modificado en T1 | `createApp()` sin `listen` (sin cambios en T2). |
| `src/server.js` | nuevo en T1 | Entrada de proceso (`PORT` + `listen`). |
| `test/smoke.test.js` | nuevo en T1 | Humo: `GET /` → 200, `/api/full-analysis/run` sin url → 400, `/api/cancel` → 200. |
| `odd/tasks/login-authentication.md` | modificado | T0/T1/T2 completados, Logs L5–L9. |

Nota: la escritura de `.env.*` está bloqueada por reglas de permisos del runtime; `.env.example` se
generó vía shell, y `.env` real lo creó la usuaria.

## Resultado de pruebas

`test/db.test.js` es de integración y depende de `TEST_DB_*`, así que `npm test` da dos resultados
válidos según haya o no base de test configurada:

```
sin TEST_DB_*   →  7 passed, 1 skipped, 0 failed   (default seguro, el habitual)
con TEST_DB_*   →  8 passed, 0 failed, 0 skipped   (contra api_to_do_qa_test)
```

Cobertura: 3 humo (T1) + 4 unit de config + 1 integración de DB real.

Verificación manual adicional (fuera de `npm test`), contra MariaDB 10.4.32 local:

```
CURRENT_USER() = qa_app@localhost
DATABASE()     = api_to_do_qa
sql_mode       = STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO
time_zone      = +00:00
```

Con `npm start` la app sigue respondiendo `GET /` → HTTP 200 con el `index.html` intacto.

## Corrección pre-T3 (posterior a la primera versión de este handoff)

Detectado por Claude Code: el test usaba `DB_*` como fallback, así que corría contra
**`api_to_do_qa` (desarrollo)**. Inofensivo hoy con `SELECT 1`, pero desde T3 los tests truncan
tablas y **borrarían los datos de desarrollo**.

Corregido: el test ahora **exige** `TEST_DB_HOST`, `TEST_DB_NAME` y `TEST_DB_USER`, y se salta si
faltan. Se eliminó el fallback a `DB_*`. El test construye su config solo con `TEST_DB_*` y nunca
pasa por `loadConfig()` ni por `.env`, con lo que `DB_NAME=api_to_do_qa` queda inaccesible para los
tests. Documentado en `db/README.md` §5.

## Riesgos y pendientes

- **Risk T1 (item 3):** `npm start` ahora ejecuta `src/server.js`. Verificado que responde igual.
- **Risk T2 (item 5):** dependencia nueva `mysql2` (la aprobada en D2). Se mantiene inerte hasta T5.
- El `.env` real está en el working tree pero **ignorado por Git** (`.gitignore:71`). Escaneo de
  contraseñas en archivos versionables: limpio.
- Sin tablas y sin migraciones: `api_to_do_qa` existe vacía.
- **Separación de usuarios para T3:** las migraciones correrán con **`qa_migrator`** (que tiene
  `CREATE, ALTER, INDEX, REFERENCES` además de DML), nunca con `qa_app`. `qa_app` solo tiene
  `SELECT, INSERT, UPDATE, DELETE` y por tanto no puede crear ni modificar el esquema. Ver
  `db/README.md` §3.
- En este XAMPP local `FLUSH PRIVILEGES` falla con error 176 Aria (resto de la corrupción previa),
  pero el `GRANT` solo sí aplica, verificado con `SHOW GRANTS`. No es bloqueante; se puede ignorar
  hasta la próxima revisión de XAMPP.
- Opcional y no bloqueante: verificar `SELECT VERSION();` en phpMyAdmin de Hostinger (diseño §8.1).

## Qué se pide revisar

1. Que T2 cubra S7 y S8 sin salirse del alcance.
2. `env.js`: validación, mensajes y el manejo de `DB_PASSWORD=""`.
3. `pool.js`: estricto + UTC aplicados por conexión, y `multipleStatements: false`.
4. Que la app existente sin DB siga arrancando (`npm start` no depende de la DB en T2).
5. Calidad de los tests y de `db/README.md`.

Tras el **aprobado**, se hará un commit Conventional (o varios, por unidad de trabajo) en
`feature/login-authentication` y push solo a esa rama. Sin merge, rebase, PR ni cambios en `main`.
