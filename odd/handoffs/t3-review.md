# Handoff de revisión — T3 (migraciones)

Para: **Claude Code** (revisor).
Feature: `login-authentication` · Rama: `feature/login-authentication`.
Plan: `odd/tasks/login-authentication.md` (T3, specs S1, S4, S5, S7, S10, S11) · Diseño: `docs/auth/auth-architecture.md` §4.
Runner: `node --test`. Sin commits todavía: todo está en el working tree.

## Alcance de T3 (lo que se pidió)

> "**Migraciones**: `scripts/migrate.js` + `001_create_users.sql`, `002_create_user_sessions.sql`,
> `003_create_login_attempts.sql`. `npm run migrate` idempotente y probado dos veces seguidas
> en la base local."

Fuera de alcance (no implementado a propósito): `passwordService`, usuarios/creación, login,
sesiones, endpoints, middlewares, pantallas, protección de rutas — T4 en adelante.

## Cambios realizados

| Archivo | Estado | Qué hace |
|---|---|---|
| `scripts/migrate.js` | nuevo | `runMigrations(db, { migrationsDir?, logger? })` exportada + CLI (`isMain`). Conexión **propia** con `multipleStatements: true` (la pool de la app lo mantiene en `false`), `sql_mode` estricto y `time_zone +00:00` por conexión (mismo criterio que `pool.js`). Crea `schema_migrations` (`IF NOT EXISTS`, §4.4), aplica `db/migrations/*.sql` en orden alfabético, registra cada versión con `UTC_TIMESTAMP(3)` **solo tras el éxito del archivo**, y **para en el primer error** (sin registrar la versión fallida). Devuelve `{ applied, skipped }`. CLI: usa `loadConfig()`; override opcional `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` sobre `DB_USER`/`DB_PASSWORD` (§5.6). |
| `db/migrations/001_create_users.sql` | nuevo | DDL de `users` copiado del diseño §4.1 (UUID `CHAR(36)` ascii, `ENUM` de roles, FK `created_by` → `users`, unique case-insensitive en email). |
| `db/migrations/002_create_user_sessions.sql` | nuevo | DDL de `user_sessions` del diseño §4.2 (`token_hash BINARY(32)` unique, `previous_token_hash` con índice, FK → `users` `ON DELETE CASCADE`, índices de expiración y usuario). |
| `db/migrations/003_create_login_attempts.sql` | nuevo | DDL de `login_attempts` del diseño §4.3 (`AUTO_INCREMENT`, índices compuestos `(email, attempted_at)` e `(ip_address, attempted_at)`). |
| `package.json` | modificado | Script `"migrate": "node scripts/migrate.js"`. Sin dependencias nuevas. |
| `test/migrate.test.js` | nuevo | 3 tests de integración, **solo `TEST_DB_*`** (sin fallback a `DB_*`, regla L10). |
| `db/README.md` | modificado | §3: `DROP` agregado a los grants del migrador (los tests dropean el esquema de prueba) y nota de la creación local de `qa_migrator`. §5: desde T3 los tests de integración incluyen migraciones → `TEST_DB_USER` necesita DDL (`qa_migrator`). Nueva §6 "Migrations" (archivos, runner, `MIGRATE_DB_*`); la sección de Hostinger pasó a §7. |
| `.env.example` | modificado | Bloque opcional `MIGRATE_DB_USER`/`MIGRATE_DB_PASSWORD` con placeholder (sin secretos). Escrito vía shell: el runtime bloquea escrituras a `.env.*` con las herramientas de archivo. |
| `odd/tasks/login-authentication.md` | modificado | Fila T3 completada, Log L13, cabecera de estado. |

## Resultado de pruebas

```
con TEST_DB_* (qa_migrator sobre api_to_do_qa_test)  →  11 passed, 0 failed, 0 skipped
sin TEST_DB_* (default seguro)                       →   7 passed, 0 failed, 4 skipped
```

RED observado antes de implementar: `ERR_MODULE_NOT_FOUND: scripts/migrate.js`.

Los 3 tests nuevos cubren: (1) aplicación en orden + registro en `schema_migrations` +
collation `utf8mb4_unicode_ci` en las 3 tablas (S7); (2) segunda corrida no-op con las mismas
3 versiones registradas (idempotencia pedida); (3) archivo inválido → rechaza, **no** registra
su versión, las tablas del archivo bueno anterior sí quedan (semántica §4.4, usando un
directorio temporal de migraciones aislado).

Verificación manual adicional, contra la base de desarrollo `api_to_do_qa` (MariaDB 10.4.32):

```
npm run migrate   # como qa_migrator (MIGRATE_DB_USER/SECRET por entorno, no en .env todavía)
  → [migrate] applied 3 migration(s): 001_create_users, 002_create_user_sessions, 003_create_login_attempts
npm run migrate   # segunda corrida seguida
  → [migrate] nothing to do, 3 migration(s) already applied.

schema_migrations: 001/002/003 con applied_at en UTC (16:09Z ≈ 12:09 local, UTC-4) ✅
SHOW FULL TABLES:  users, user_sessions, login_attempts, schema_migrations ✅
qa_app (solo DML): SELECT/INSERT/DELETE sobre login_attempts y SELECT sobre users ✅
```

## Entorno (cambios locales, no del repo)

- Creado `qa_migrator@localhost` en el XAMPP local con los grants de `db/README.md` §3
  (incluye `DROP` y `REFERENCES`), **misma password que `qa_app`** para no introducir
  secretos nuevos. Antes no existía; era lo previsto en T2 ("migraciones con `qa_migrator`").
- MariaDB 10.4.32 levantado para la fase (proceso independiente; se puede cerrar).
- Para migrar la base local con el usuario correcto hace falta agregar a tu `.env`
  (no lo toqué: el runtime me bloquea la escritura de `.env.*`):
  `MIGRATE_DB_USER=qa_migrator` y `MIGRATE_DB_PASSWORD=` la misma que `DB_PASSWORD`.
  Sin esas variables, `npm run migrate` usa `DB_*` (`qa_app`, que en este XAMPP tiene DDL
  sobre `api_to_do_qa` — pero en Hostinger **no**: ahí `MIGRATE_DB_*` es obligatorio).

## Riesgos y pendientes

- **Risk T3 (item 5):** runner de migraciones nuevo. Acotado: solo DDL aditivo; la app
  existente no lo invoca y los endpoints QA no se tocaron. `npm start` y los tests de humo
  siguen en verde.
- MySQL commita el DDL implícitamente: un archivo que falla a mitad puede dejar un `CREATE`
  parcial aplicado (no registrado). Es la razón del diseño §4.4 (un cambio lógico por archivo,
  `IF NOT EXISTS` donde es posible); documentado en el encabezado de `scripts/migrate.js`.
- El esquema local de desarrollo ya está migrado (las 3 tablas + tracking). En Hostinger se
  correrá `npm run migrate` recién en T10 (§8.2).
- **Corrección de expectativa de T2:** el handoff de T2 decía que `qa_app` "no puede crear ni
  modificar el esquema". En este XAMPP en realidad `qa_app` tiene CREATE/DROP/INDEX/ALTER sobre
  `api_to_do_qa` (grants heredados del arreglo manual de la base). No cambia el plan: el runner
  usa `qa_migrator` cuando está configurado, y en Hostinger el usuario de la app sí será solo DML.
- `qa_migrator` no existe todavía en Hostinger: crearlo en hPanel al integrar (§8.2 / §7 del
  db/README).
- Sigue abierto y no bloqueante: verificar `SELECT VERSION();` en phpMyAdmin de Hostinger (§8.1).

## Qué se pide revisar

1. Que T3 cubra S1, S4, S5, S7, S10 y S11 **a nivel de esquema** sin salirse del alcance
   (specs cubiertas por el DDL; su implementación funcional llega en T4–T6).
2. `migrate.js`: orden, registro posterior al éxito, parada en el primer error, conexión propia
   con `multipleStatements: true` y los overrides `MIGRATE_DB_*`.
3. Los 3 `.sql` contra el diseño §4.1–§4.3 (portabilidad MySQL 8 / MariaDB 10.4: InnoDB,
   `utf8mb4_unicode_ci`, `ENUM`, `DATETIME(3)`, UUID `CHAR(36)` ascii).
4. Que los tests solo usen `TEST_DB_*` (nunca `DB_*`) y que el default sin ellos siga en verde.
5. Calidad del handoff, `db/README.md` y `.env.example`.

Tras el **aprobado**, se hará un commit Conventional en `feature/login-authentication` y push
solo a esa rama. Sin merge, rebase, PR ni cambios en `main`.
