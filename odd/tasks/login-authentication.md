# login-authentication

Objetivo: autenticación con cuentas creadas por un admin, login con correo y contraseña, pantalla de cambio de contraseña, sesión de 7 días y logout, sobre MySQL (compatible con Hostinger). Diseño técnico: `docs/auth/auth-architecture.md` (v2, MySQL).
Rama: `feature/login-authentication` · Entrega: `ask-on-risk` (forecast ~1.500 líneas → antes de superar 400 se pregunta la estrategia de PR encadenados) · Runner: `node --test`.
Estado: **T0 aprobado (2026-10-13). T1 completado. Siguiente: T2 (pendiente de autorización).**

## Specs

- **S1 — Cuentas creadas por admin.** "cada miembro del equipo tenga una cuenta creada por un administrador". No hay registro público. El primer admin se crea con `npm run create-admin`; los siguientes, por la API admin.
- **S2 — Login.** "pueda iniciar sesión con correo y contraseña". Endpoint `POST /api/auth/login`; página pública `login.html`.
- **S3 — Cambio de contraseña con pantalla.** "Quiero una pantalla para que el usuario pueda cambiar su contraseña, no solamente un endpoint." Página `change-password.html` (contraseña actual, nueva y confirmación) más `POST /api/auth/change-password`. Accesible desde la barra superior de `index.html`.
- **S4 — Sesión de 7 días y Logout.** "Las sesiones deben durar 7 días. Definí una política segura de expiración y renovación." Política en el diseño §5.2: 7 días fijos desde el login, token rotado cada 24 h de uso y revocación inmediata en logout y cambio de contraseña. `POST /api/auth/logout`.
- **S5 — Roles.** "roles (`admin` y `qa_engineer`)". Solo `admin` gestiona usuarios (`/api/admin/users/*`).
- **S6 — Contraseñas seguras.** "contraseñas seguras". scrypt con salt, comparación en tiempo constante y política de 12 a 128 caracteres (diseño §5.1).
- **S7 — MySQL.** "Usaremos MySQL, no PostgreSQL, para mantener compatibilidad con nuestro hosting en Hostinger." El esquema funciona en MySQL 8.0+ y en MariaDB 10.4+ (diseño §4).
- **S8 — Local primero, después Hostinger, en la nube.** "primero desarrollaremos y probaremos localmente y después integraremos los cambios en el servidor de Hostinger." · "No incluyas NSSM ni configuraciones de servicios de Windows. Prepará la arquitectura para un entorno de producción en la nube." Solo cambian las variables de entorno (diseño §8).
- **S9 — Toda la app requiere login, en servidor.** "Toda la aplicación debe requerir Login. Ningún usuario sin autenticar debe poder acceder a las herramientas de QA ni a sus endpoints protegidos." · "Verificá que el plan contemple la protección del frontend y de la API, no solamente una redirección visual al Login." Modelo de negación por defecto en el diseño §6, con un test de inventario de rutas.
- **S10 — UUID.** "Utilizaremos UUID para identificar usuarios." `users.id CHAR(36)`, generado con `crypto.randomUUID()`.
- **S11 — Preparado para vincular QA.** "Prepará el sistema para que otro desarrollador pueda vincular posteriormente cada QA con `users.id`." Contrato en el diseño §4.5. La tabla `qa_runs` **no** forma parte de esta feature.
- **S12 — Sin cambios innecesarios.** "evitando migraciones o cambios innecesarios". El frontend sigue en HTML/CSS/JS vanilla y los endpoints QA mantienen su contrato.

Fuera de alcance: guardar los QA en la base, pantalla de administración de usuarios, recuperación de contraseña por email, SSO/2FA, migrar el frontend y cualquier configuración de servicios de Windows (NSSM).

## Decisiones

| ID | Decisión de la usuaria (2026-10-13) | Resolución técnica |
|----|-------------------------------------|--------------------|
| D1 | MySQL por compatibilidad con Hostinger | Esquema portable entre MySQL 8.0+ y MariaDB 10.4+ (InnoDB, utf8mb4_unicode_ci, ENUM, DATETIME(3) en UTC). |
| D2 | La que Claude considere mejor | **`mysql2`** (promesas y sentencias preparadas) + SQL plano en repositorios + migraciones `.sql` numeradas con un runner propio. Sin ORM. Única dependencia nueva. |
| D3 | La de menor fricción sin comprometer la seguridad | **scrypt de `node:crypto`**: aceptado por OWASP, sin dependencias ni compilación nativa, funciona en cualquier plan Node de Hostinger. |
| D4 | Sesiones de 7 días | Caducidad fija de 7 días desde el login, rotación del token cada 24 h de uso (gracia de 60 s), revocación inmediata. Diseño §5.2. |
| D5 | UUID | `CHAR(36)` ascii generado en Node; portable (no usa `UUID_TO_BIN` ni el tipo `UUID` de MariaDB). |
| D6 | Pantalla para cambiar la contraseña | `change-password.html`. La gestión de usuarios queda por API y CLI; la pantalla de admin no está incluida. |
| D7 | La app ya corre en un servidor de Hostinger; no hay despliegue por servicio local | Sin NSSM. Arranque `npm start` → `src/server.js`; `PORT` lo asigna el hosting. |
| D8 | Sin NSSM; arquitectura para producción en la nube | Variables en el panel de Hostinger, `trust proxy`, HTTPS + HSTS, cookie `Secure`, rate limit en MySQL (sobrevive reinicios y varias instancias). |
| D9 | Toda la app requiere login | Negación por defecto en el servidor: el HTML protegido nunca se envía sin sesión y la API responde 401. Diseño §6. |

**Verificación pendiente antes de T2 (sin bloquear el plan):** la usuaria consulta en hPanel → phpMyAdmin `SELECT VERSION();` para saber si Hostinger usa MySQL o MariaDB y qué versión, y elegir el motor local equivalente (diseño §8.1).

## Tasks

Ruta: OpenCode implementa una fase por vez, inline. Cada fase termina con la app funcionando, sus tests en verde y un commit Conventional en `feature/login-authentication`. Claude Code revisa cada fase antes de habilitar la siguiente.

| ID | Fase | Specs | Ruta | Riesgo | Estado | Evidencia |
|----|------|-------|------|--------|--------|-----------|
| T0 | Aprobación final del plan v2 por la usuaria | todas | usuaria | — | **completada** | aprobado 2026-10-13 junto con T1 (L5) |
| T1 | **App testeable sin cambiar el comportamiento**: separar `src/app.js` (`createApp()`) de `src/server.js` (`listen`), `npm start` → `src/server.js`, script `test`, test de humo (GET `/` → 200 y un endpoint QA responde igual que antes). | S8, S12 | OpenCode | bajo | **completada** | RED: `createApp` no exportado; GREEN: 3/3 tests en verde (`npm test`), `npm start` sirve `/` → HTTP 200. Sin commits (la usuaria lo decide). |
| T2 | **Config y conexión MySQL**: agregar `mysql2`, `src/config/env.js`, `src/db/pool.js` (UTC, modo estricto, `multipleStatements: false`), `.env.example`, `db/README.md` (motor local con XAMPP o Docker, usuarios `qa_app` y `qa_migrator`). Sin tablas todavía. | S7, S8 | OpenCode | medio (dependencia nueva) | pendiente | — |
| T3 | **Migraciones**: `scripts/migrate.js` + `001_create_users.sql`, `002_create_user_sessions.sql`, `003_create_login_attempts.sql`. `npm run migrate` idempotente y probado dos veces seguidas en la base local. | S1, S4, S5, S7, S10, S11 | OpenCode | medio | pendiente | — |
| T4 | **Usuarios y contraseñas**: `passwordService`, `userRepository`, `scripts/create-admin.js` (pide la contraseña por consola, sin argumentos visibles). Tests unitarios de hash, verificación, `needsRehash` y política. | S1, S5, S6, S10 | OpenCode | alto (credenciales) | pendiente | — |
| T5 | **Sesiones y login por API**: `sessionRepository`, `loginAttemptRepository`, `authService`, `sessionMiddleware` (rotación y expiración), `originCheck`, `securityHeaders`, `errorHandler`; endpoints `login`, `logout` y `me`. Las rutas QA **todavía sin proteger**. | S2, S4, S6 | OpenCode | alto (sesiones) | pendiente | — |
| T6 | **Cambio de contraseña (API)**: endpoint, revocación de las otras sesiones, `requirePasswordChanged` y flujo de `must_change_password`. | S3, S4, S6 | OpenCode | alto | pendiente | — |
| T7 | **Pantallas**: `public-auth/login.html` + `login.js`; `public/change-password.html` + `change-password.js`; barra superior de `index.html` con usuario, "Change password" y "Logout"; redirección ante 401. Todavía sin bloquear el acceso. | S2, S3, S4, S12 | OpenCode | bajo | pendiente | — |
| T8 | **Protección en servidor (negación por defecto)**: orden de middlewares del diseño §6, `express.static('public', { index: false })`, allow-list pública, `requireAuth` delante de todas las rutas QA y de `public/`. **Test de inventario de rutas** y pruebas sin cookie (todas las rutas QA → 401, `index.html` → 302). Con sesión, los endpoints QA responden igual que antes. | S9, S11, S12 | OpenCode | alto (guards) | pendiente | — |
| T9 | **API de administración de usuarios**: `requireRole('admin')`, `/api/admin/users/*`, guards de último admin y de auto-degradación/desactivación, revocación de sesiones al resetear o desactivar. | S1, S5 | OpenCode | alto (permisos) | pendiente | — |
| T10 | **Hardening para la nube y documentación**: `trust proxy`, redirección a HTTPS y HSTS en producción, README y `db/README.md` con el procedimiento de integración en Hostinger (diseño §8.2). | S8 | OpenCode | medio | pendiente | — |
| T11 | **Revisión final**: diff completo, `npm test`, prueba manual local del flujo completo, veredicto por `S#`. Checklist de Hostinger lista para la usuaria. | S1–S12 | Claude Code | — | pendiente | — |

Orden y motivo:
- T1 hace posible testear todo lo que sigue.
- T2–T3 preparan la base antes de usarla.
- T4–T6 son el backend probado por API.
- T7 agrega las pantallas.
- **T8 bloquea la app recién cuando el login ya funciona**, para que nadie quede afuera.
- T9 agrega la gestión de cuentas; hasta entonces el CLI de T4 alcanza para crear usuarios.
- T10 prepara la integración en Hostinger.

T4, T5, T6, T8 y T9 son de alto riesgo: cada una recibe verificación independiente de Claude Code antes de pasar a la siguiente.

## Protocolo de coordinación

1. Al empezar una fase: `mem_search "login-authentication"` (proyecto `api-to-do-qa`), y después leer este archivo hasta `## Log` y el diseño `docs/auth/auth-architecture.md`.
2. Test primero: observar RED y después GREEN con `npm test`. Anotar la evidencia en la fila de la tarea.
3. Al cerrar la fase: hacer un commit Conventional en `feature/login-authentication`, actualizar la fila, agregar una entrada al Log y actualizar Engram (topic `odd/login-authentication/tasks`).
4. No hacer push ni PR (lo decide la usuaria). No tocar el servidor de Hostinger: la integración la hace la usuaria siguiendo el diseño §8.2.
5. No guardar secretos en el repo. `.env` está ignorado; solo se commitea `.env.example`.
6. Ante cualquier duda de producto, anotarla en el Log como pregunta y detenerse.

## Log

- **L1 (2026-10-13, usuaria, literal):** "Quiero comenzar a implementar un sistema completo de autenticación para mi proyecto `api-to-do-qa`. El objetivo es que cada miembro del equipo tenga una cuenta creada por un administrador, pueda iniciar sesión con correo y contraseña, cambiar su contraseña y mantener su sesión activa. Más adelante, cada QA realizado estará asociado a su usuario y se almacenará en PostgreSQL. Por ahora quiero únicamente el análisis y la planificación. No modifiques código. […] Considerá que inicialmente utilizaremos PostgreSQL local y posteriormente una base de datos alojada en un servicio compatible con Hostinger. Definí cómo manejar usuarios, roles (`admin` y `qa_engineer`), contraseñas seguras, sesiones persistentes, Logout y cambio de contraseña. […] No instales dependencias, no crees tablas, no modifiques archivos funcionales y no implementes todavía el Login."
- **L2 (2026-10-13, Claude Code):** análisis inicial. Frontend en HTML/CSS/JS vanilla, Express 5.2.1 y Node 22.23.3. Plan v1 con PostgreSQL y decisiones D1–D9 abiertas.
- **L3 (2026-10-13, usuaria, literal):**
  - "D1: Usaremos MySQL, no PostgreSQL, para mantener compatibilidad con nuestro hosting en Hostinger."
  - "D2: Elegí la alternativa técnica que consideres mejor según la arquitectura actual, priorizando seguridad, mantenimiento y simplicidad."
  - "D3: Elegí la opción que genere menos fricción de implementación y mantenimiento, sin comprometer la seguridad."
  - "D4: Las sesiones deben durar 7 días. Definí una política segura de expiración y renovación."
  - "D5: Utilizaremos UUID para identificar usuarios."
  - "D6: Quiero una pantalla para que el usuario pueda cambiar su contraseña, no solamente un endpoint."
  - "D7: La aplicación ya está funcionando en un servidor de Hostinger. No estamos planificando desplegarla mediante un servicio local."
  - "D8: No incluyas NSSM ni configuraciones de servicios de Windows. Prepará la arquitectura para un entorno de producción en la nube."
  - "D9: Toda la aplicación debe requerir Login. Ningún usuario sin autenticar debe poder acceder a las herramientas de QA ni a sus endpoints protegidos."
  - "Considerá que primero desarrollaremos y probaremos localmente y después integraremos los cambios en el servidor de Hostinger. Verificá que el plan contemple la protección del frontend y de la API, no solamente una redirección visual al Login. […] No avances a la implementación hasta que apruebe el plan actualizado."
- **L4 (2026-10-13, Claude Code):** plan v2. PostgreSQL → MySQL en todo el diseño: esquema, migraciones (el DDL de MySQL hace commit implícito, así que se usa un archivo por cambio), driver `mysql2`, sesiones y variables de entorno.
  - Se eliminó toda referencia a NSSM.
  - El rate limit pasó de memoria a MySQL, porque en la nube hay reinicios y puede haber varias instancias.
  - La pantalla de login se movió a `public-auth/` para que nada de `public/` sea público por error.
  - Se agregó el modelo de negación por defecto con test de inventario de rutas.
  - Entorno local encontrado: XAMPP MariaDB 10.4.32 y Docker 29.
  - Specs reescritas: S3, S4, S7, S8 y S9; specs nuevas: S10, S11 y S12.
  - Siguiente paso: T0.
- **L5 (2026-10-13, usuaria):** autoriza T0 y T1: "Autorizo la ejecución de **T0 y T1** del plan ODD actualizado. […] No cambies de branch ni hagas commits, push, pull o merge. […] No avances a T2 sin mi autorización."
- **L6 (2026-10-13, OpenCode):** T0 registrado (aprobado). T1 implementado: `src/app.js` exporta `createApp()` sin `listen`; nuevo `src/server.js` como entrada (`PORT` de env); `package.json` scripts `start`/`dev`/`test` apuntan a `server.js` y `node --test`; nuevo `test/smoke.test.js` (GET `/` → 200, `POST /api/full-analysis/run` sin url → 400, `POST /api/cancel` → 200). Evidencia: RED (export faltante) → GREEN 3/3 + `npm start` arranca y sirve el index (HTTP 200). **Sin commit, por instrucción explícita de la usuaria** (el protocolo de fase lo pide, prevalece la instrucción de la usuaria). Siguiente: T2, esperando autorización.
- **Nota:** el piloto `odd/tasks/compare-lines-duplicados.md` sigue pendiente y es independiente de esta feature.
