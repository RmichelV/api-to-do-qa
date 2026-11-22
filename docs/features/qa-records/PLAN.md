# Plan: Guardado de QA y vista QA Shadow

Spec: [`SPEC.md`](SPEC.md). Rama: `feature/qa-records` (sale de `master`, que ya tiene login, roles y MariaDB).
Cada fase se puede probar sola y cierra con su commit. Las reglas vienen solo de la spec; lo que falta está en [Dudas](#dudas).

## Punto de partida (código actual)

- **Login y roles:** sesiones en `user_sessions`, `req.user` con `id` y `role`. Roles actuales: `ENUM('admin','qa_engineer')` en `db/migrations/001_create_users.sql` y `USER_ROLES` en `src/services/adminUserService.js:19`. Guardas: `requireAuth`, `requireRole(role)`, `requireAdminPage([...])` en `src/middleware/`.
- **Orden de middleware** (`src/app.js`): todo lo que se monte después de `requireAuth` queda protegido; `test/routeInventory.test.js` falla si una ruta responde sin sesión.
- **Capas:** `routes/` → `controllers/` → `services/` → `repositories/` (SQL con `pool.execute`). Los services reciben `req.user.id`, nunca `req`.
- **Migraciones:** `db/migrations/NNN_*.sql`, una sola modificación por archivo (el DDL de MySQL hace commit implícito), aplicadas por `npm run migrate` en cada deploy. Producción: usuario `qa_migrator` **sin DROP**; la app usa `qa_app` (solo DML).
- **Convenciones de esquema:** ids `CHAR(36)` ascii, `DATETIME(3)` en UTC puesto por la app, `utf8mb4_unicode_ci`.
- **Frontend:** `public/index.html` (scripts inline). Ya existe un "QA Todo List" (`#todo-panel`, líneas 71–89) con checks auto y manuales, y un PDF hecho en el navegador con `html2pdf` (`downloadPDF()`, línea 1453).
- **Tests:** `node --test`, integración solo contra `TEST_DB_*`.

## Decisiones (respuestas de la usuaria, 2026-11-07)

- **D1. QA Shadow es un rol nuevo** (`qa_shadow`). No es fijo: la Admin cambia el rol del usuario cada semana desde la pantalla de usuarios, con un control para cambiar el rol.
- **D2. Se elimina el campo QA Link.** Al cerrar, el resultado (comment, status y checklist) lo ve la persona que hizo el QA: el Engineer ve el resumen de su QA cerrado y descarga el PDF desde su vista.
- **D3. Resumen liviano** (recomendación aceptada como propuesta, ver F1): JSON por check con estado y conteos; detalle solo de lo que falló, con tope de 20 ítems por check, textos de hasta 200 caracteres y 16 KB por registro.
- **D4. Retención por mes:** los QA de un mes se guardan todo ese mes y se borran el **día 10 del mes siguiente**. Ejemplo literal: "de octubre se guarda todo el mes hasta el 10 de noviembre que se reinicia y obvio solo eliminaria lo de octubre y quedaria todo noviembre hasta el 10 de diciembre".
- **D5. El QA Shadow no se revisa a sí mismo** (corregido el 2026-11-07): "el shawo puede ver sus qa guardados no se por que bloqueas eso igual podria guardar un qa que el se haga simplemente no le va a salir en lo pendiente para revsar". Con rol `qa_shadow` puede guardar QA y usar "Mis QA"; sus QA no aparecen en su lista de pendientes y no puede cerrarlos.
- **D8. El QA Shadow da el criterio final:** el estado y el comentario se generan con la tabla de criterios y el Shadow puede editar los dos al cerrar el QA.
- **D10. Un QA tomado queda bloqueado:** "una vez lo toma queda bloqueado solo el puede terminarlo y obvio el duenho del qa puede ver la revision del shadow en su perfil con sus Qa". Al tomarlo desaparece de los pendientes de los demás Shadows y solo quien lo tomó puede editarlo y cerrarlo. El owner ve la revisión en "Mis QA" **solo cuando está cerrada**; antes no ("solo cuando esta cerrada ve la revision antes no"). Se irá ajustando sobre la marcha.
- **D11. Formato del Task ID:** "tiene una letra y numeros ejemplo D-174735 yo creo que cuando estos se acaben aumentan". Lo da el sistema y es único: **nunca se repite** (D18).
- **D12. Nota para el QA Shadow:** "una vez guarda el QA solo puede verlo y editar el task ID puede dejar una nota al QA shadow igual al momento de guardar". La nota se escribe solo al guardar, no se edita después y le aparece al Shadow (para especificaciones especiales).
- **D13. El mes se corta en hora de Bolivia** (`America/La_Paz`, UTC−4 sin horario de verano), tanto para "Mis QA" como para el borrado y el CSV mensual.
- **D14. Lista del Shadow:** solo QA pendientes de revisión; los cerrados salen de la lista (aunque los haya cerrado otro Shadow). El Shadow tiene además un **historial** con los QA que él revisó. Ambos se buscan por Task ID.
- **D15. El checklist manual no tiene nada que ver con el "QA Todo List" actual.** Los ítems manuales y la calificación de los bugs los pasa la usuaria en `BUGS.md`.
- **D16. CSV del Admin cuando quiera.** El plazo del día 1 al 9 para bajar el mes anterior alcanza, porque el QA Shadow es semanal.
- **D17. El Admin solo ve la lista completa:** no edita, no reabre y no cambia Task IDs.
- **D18. Los Task ID no se repiten:** son números únicos que da el sistema.
- **D9. Puede haber más de un QA Shadow a la vez.** "cuando ya le quito el shadow se borran sus pendientes": al quitarle el rol, se borran sus revisiones sin cerrar y esos QA vuelven a quedar pendientes.
- **D6. Quién es el QA Shadow:** "el qa shadow me lo pasa una persona y yo asigno en la herramienta". La Admin asigna el rol; el campo "QA Shadow" del cierre es el usuario logueado con ese rol (se toma de la sesión, no se elige a mano).
- **D21. Status final y dispositivo:** "el shadow elige en la parte manual en que dispositivo es el bug y si el estado final seria algo asi Critical si solo es 1 y si son mas de 1 como critical (1) , Failed (2) , opportunity (1)". Con un solo bug, el status es su severidad (`Critical`). Con más de uno, el conteo por severidad: `Critical (1), Failed (2), Opportunity (1)`. Sin bugs: `Passed`. En cada bug manual que marca como Bug, el Shadow elige el dispositivo (`M`, `D` o `M/D`).
- **D19. Checklist manual = bugs que la herramienta no revisa** (de `BUGS.md`, ver F0).

Respuestas de la usuaria del 2026-11-10 a las dudas pendientes:

- **D22. Task ID:** una letra, un guion y números, como `D-147856` (una sola letra). Se guarda en mayúsculas.
- **D23. Dispositivo de los bugs de la herramienta:** "si no dice mobile es desktop y ya esto lo revisa el shadow". `M` cuando el hallazgo viene del análisis mobile; `D` en todos los demás.
- **D24. Checklist completo para cerrar:** "hay que completar todos aunque sea con N/A pero todos tienen que estar cerrados para continuar".
- **D25. QA sin bugs:** "si no tiene bug es passed sin mas comments". El status es `Passed`, no se genera comentario y el campo de comentario queda opcional.
- **D26. N/A sobre hallazgos de la herramienta:** el Shadow puede marcar como N/A un hallazgo automático con un botón de editar; es opcional, no obligatorio.
- **D27. Explicación del N/A opcional:** "si quiere puede explciar no quiero hacerlo muy pesado".
- **D28. FAIL-09 lo revisa solo la herramienta** (no va al checklist manual).
- **D29. Los bugs "To decide" de `BUGS.md` son manuales** (columna Check type actualizada).
- **D30. FAIL-04 es el atributo alt** y lo revisa la herramienta (texto corregido en `BUGS.md`).
- **D31. CSV:** el del Admin y el del Shadow tienen **las mismas columnas**; la lista la pasa la usuaria (Dudas 1).
- **D33. El dueño ve su resumen desde "Mis QA"** (2026-11-12): con un clic en "Ver", también en QA pendientes. La revisión del Shadow sigue visible solo al cerrar (D10, F6).
- **D34. Desactivar a un Shadow también libera sus QA** (2026-11-16, respuesta de la usuaria: "si deberian volverse pendientes"): si la Admin desactiva a un usuario `qa_shadow`, sus QA tomados y sin cerrar vuelven a pendientes igual que en D9 (misma transacción, mismo borrado). Los cerrados no se tocan.
- **D32. Resumen legible para el Shadow** (2026-11-10, sobre F2): "TIENES QUE PONER EL RESULTADO QUE DA CADA SECCION POR LO MENOS EL RESUMEN Y EN LOS LINKS TIENE QUE MOSTRAR LOS FAILED SI NO EL SHADOW NO SABRA CUAL ES EL PROBLEMA SI GUARDAMOS INFO TAN AMBIGUA OBVIO NO TIENE QUE SER MUY EXPLICITO". Cada check guarda la misma línea de resultado que muestra su panel y el detalle de lo que falló (en links, cada link que falló con su código), cada hallazgo con su ID de bug y dispositivo.
- **D20. Comentario: una línea por bug** con el formato `Dispositivo / Tipo / Severidad / Descripción`. Ejemplos literales de la usuaria: "M/D / Styling / Failed / Croppe Images" y "M/D / Instructions / Critical / The instructions was not followed as requested". `M/D` = mobile y desktop. Si hay más de un bug, se registra cada uno. El QA Shadow puede editar el comentario. El tipo de cada bug está en la columna **Type** de `BUGS.md` (agregada por Claude Code con criterio propio, a pedido de la usuaria): Styling, Images, Links, Anchors, H1, Inventory, SEO, Forms, Copy, Instructions.
- **D7. Tabla de criterios (cargada en `BUGS.md`; regla del status en D21 y formato del comentario en D20):** los bugs manuales junto con los automáticos dan el estado final (Passed, Opportunity, Failed, Critical). La tabla de criterios se usa al cerrar el QA para categorizar el estado **y para generar el comentario**.
- `SPEC.md` actualizado el 2026-11-07 con D1, D2, D4, D5, D6 y D7.

---

## Fase 0: Documento de bugs y clasificación (sin código)

**Objetivo:** tener la tabla de bugs y la tabla de criterios (D7), de las que dependen el checklist manual, el status final y el comentario generado (F5). Corresponde a los pasos 1 y 2 de la spec.

**Archivos:** `docs/features/qa-records/BUGS.md` (cargado por la usuaria el 2026-11-07: "Bug Clarifications v2.0", 21 bugs con ID, severidad y si la herramienta los revisa hoy).

**Tareas:**
- [x] Listar cada bug y marcarlo como "lo detecta la herramienta" o "manual" (paso 1): columnas "Tool today" y "Check type".
- [x] Clasificar cada bug como Opportunity, Failed o Critical (paso 2).
- [x] Definir la regla que combina los bugs encontrados en un status final (D21, D25).
- [x] Definir el formato del comentario generado (D20); tipos en `BUGS.md`; dispositivo en D21 y D23.
- [x] Derivar la lista de ítems del checklist manual: los bugs que la herramienta **no** revisa (ver abajo).

**Checklist manual del QA Shadow** (D19: "los bugs que no agarra la herramienta son los que tenes que poner el check list manual"). Cada ítem: Passed / Bug / N/A.

| ID | Ítem | Severidad si es Bug |
|---|---|---|
| OPP-01 | Margins and paddings | Opportunity |
| OPP-02 | Visual styling (colors, gradients, CTAs, links, content) | Opportunity |
| FAIL-01 | Cropped images | Failed |
| FAIL-11 | Incorrect H1 page title | Failed |
| FAIL-12 | Inventory: wrong number of vehicles | Failed |
| FAIL-13 | Inventory: wrong vehicle inventory | Failed |
| FAIL-14 | Inventory: wrong inventory style | Failed |
| FAIL-15 | Sitemap XML/HTML not enabled | Failed |
| FAIL-16 | Lead source: incorrect Source field in forms | Failed |
| FAIL-17 | FAQ Schema (Schema.org validator) | Failed |
| CRIT-02 | Wrong copy (parte manual) | Critical |
| CRIT-03 | Instructions not followed | Critical |

**Bugs que revisa la herramienta** (entran al resumen D3 y al status sin que el Shadow los marque):

| Check de la herramienta | Bugs |
|---|---|
| Images | FAIL-02 src, FAIL-03 title, FAIL-04 alt |
| Link Statuses | FAIL-05 relative link, FAIL-06 broken links |
| Links Added in Page | FAIL-07 links not verified |
| Anchors | FAIL-08 anchors not configured, FAIL-09 relative path with anchor |
| H1 | FAIL-10 double H1 |
| Text Desktop / Mobile | CRIT-01 missing copy, CRIT-02 wrong copy (parte automática) |

Consecuencia para F1: el resumen (D3) guarda cada hallazgo de la herramienta **con su ID de bug** (`FAIL-06`, `CRIT-01`…), así el status y el comentario salen de la misma tabla para lo automático y lo manual.

**Criterios de aceptación:** cada bug tiene origen (herramienta/manual) y clasificación; la lista de ítems manuales está cerrada; con la tabla se puede calcular el estado final y el comentario de cualquier combinación de hallazgos.

**Prueba manual:** revisión del documento por el equipo; nada que ejecutar.

---

## Fase 1: Tabla de QA guardados

**Objetivo:** crear el almacenamiento de los QA con un solo registro por Task ID.

**Archivos:**
- `db/migrations/004_create_qa_records.sql`
- `db/migrations/005_create_qa_record_bugs.sql`
- `src/repositories/qaRecordRepository.js`
- `test/qaRecordRepository.test.js`
- `test/migrate.test.js` (lista de migraciones 001–005 y limpieza del esquema; quedó acoplado al número de migraciones)

**Tareas:**
- [x] Migración `qa_records`: `id` (UUID), `task_id` con **índice UNIQUE**, `owner_id` (FK a `users.id`), `page_url`, `note_for_shadow` (D12, opcional), `summary` (JSON, D3), campos del QA Shadow (quién revisó, comment, status y checklist; **sin QA Link**, D2), `closed_at`, `closed_by`, `created_at`, `updated_at`.
- [x] Status final (D21): guardar el conteo de bugs por severidad (`critical_count`, `failed_count`, `opportunity_count`) y armar el texto a partir de ellos; sin bugs = Passed.
- [x] Guardar cada bug encontrado (automático o manual) con ID de bug, dispositivo (`M`, `D` o `M/D`), tipo, severidad, descripción y `source` (`tool`/`manual`, D9), para generar el comentario (D20).
- [x] Guardar el checklist manual de forma que cada ítem tenga `passed` / `bug` / `n/a` (ítems según F0).
- [x] Índice por `created_at` para la vista del mes (F3) y el borrado mensual (F8).
- [x] Repository con insert, búsqueda por `task_id` y listado; sin lógica de negocio.

> Hecho el 2026-11-07: los conteos D21 viven en columnas; el texto del status (`Critical (1), Failed (2), ...` o `Passed`) se arma en F5 al cerrar, como ya asigna el plan. Bugs en tabla aparte `qa_record_bugs` (una fila por hallazgo, orden de inserción = orden del comentario).

**Forma del resumen (D3):**

```json
{
  "version": 1,
  "ranAt": "2026-11-07T14:03:00Z",
  "checks": {
    "h1":          { "status": "fail", "total": 2, "failed": 1, "items": ["Found 2 H1 tags"] },
    "linkStatus":  { "status": "fail", "total": 120, "failed": 2,
                     "items": [{ "url": "https://…/old-page", "code": 404 }] },
    "linksAdded":  { "status": "pass", "total": 8, "failed": 0 },
    "textDesktop": { "status": "fail", "total": 54, "failed": 1, "items": ["Missing: \"Schedule service…\""] },
    "textMobile":  { "status": "pass", "total": 54, "failed": 0 },
    "images":      { "status": "pass", "total": 12, "failed": 0 },
    "anchors":     { "status": "not_run" }
  }
}
```

- `status`: `pass` / `fail` / `not_run`. `items` solo cuando hay fallas: máximo 20 por check y textos de hasta 200 caracteres.
- El servidor valida la forma y rechaza resúmenes de más de 16 KB (respuesta 400).
- La columna es `JSON` (en MariaDB es `LONGTEXT` con `CHECK (JSON_VALID(...))`, compatible con MySQL 8).

**Criterios de aceptación:**
- `npm run migrate` aplica la migración en local y es no-op al repetirla.
- Insertar dos registros con el mismo `task_id` falla por el índice único.
- La migración no usa DROP (corre como `qa_migrator` en producción).

**Prueba manual:**
1. `docker compose -f docker-compose.dev.yml up -d` y `npm run migrate`.
2. Con un cliente SQL en `127.0.0.1:3307`, ver la tabla `qa_records` y su índice único en `task_id`.
3. `node --test test/qaRecordRepository.test.js`.

---

## Fase 2: Botón "Guardar QA"

**Objetivo:** que el QA Engineer guarde una sola vez el resumen de su task (paso 3 de la spec).

**Archivos:**
- `src/services/qaRecordService.js`, `src/controllers/qaRecordController.js`, `src/routes/qaRecordRoutes.js`
- `src/app.js` (montar `/api/qa-records` después de `requireAuth`)
- `public/index.html` (botón y campo Task ID), `public/styles.css` (estilo de la tarjeta Guardar QA)
- `test/qaRecordsApi.test.js`, `test/routeInventory.test.js` (no hizo falta editarlo: recorre el router solo y ya exige 401 en la ruta nueva)

**Tareas:**
- [x] `POST /api/qa-records` con Task ID, nota opcional para el QA Shadow (D12) y el resumen de la corrida; el owner es `req.user.id`.
- [x] Validar el formato del Task ID (D22): **una** letra, guion y números, como `D-147856`; se guarda en mayúsculas (`d-147856` = `D-147856`) y los números pueden crecer de largo. *(Corregido en la revisión: la primera versión aceptaba varias letras.)*
- [x] Resumen legible (D32, D23): cada check guarda `result` (la línea que muestra su panel) y en `items` cada hallazgo con `bugId`, `device` y texto; en links, cada link que falla con su código y los absolutos (FAIL-05). *(Agregado en la revisión.)*
- [x] Si el Task ID ya existe → **409**, sin tocar el registro existente ("no se puede guardar otro encima").
- [x] Se acepta aunque haya bugs.
- [x] Botón **"Guardar QA"** en `index.html`: se guarda solo al presionarlo, nunca al correr la herramienta.
- [x] Mensaje claro en pantalla cuando el Task ID ya existe.
- [x] Agregar la ruta al inventario de rutas protegidas.

**Criterios de aceptación:**
- Sin sesión → 401 `unauthenticated`.
- Un `qa_shadow` también puede guardar su QA (D5). *Cumplido por construcción:* la ruta no tiene guardia de rol, solo sesión. Sin el rol `qa_shadow` (F4) todavía no hay con quién probarlo.
- Primer guardado → 201; segundo con el mismo Task ID → 409 y el primero queda igual.
- Correr la herramienta no crea registros.

**Prueba manual:**
1. Entrar como `qa_engineer`, correr la herramienta sobre una URL, escribir un Task ID y presionar "Guardar QA" → mensaje de éxito.
2. Presionar otra vez con el mismo Task ID → mensaje de que ya existe.
3. Correr la herramienta de nuevo sin presionar el botón → en la base no aparece un registro nuevo.

> Hecho el 2026-11-10. Decisiones de implementación:
> - **El resumen se arma en el navegador** a partir de lo que cada panel ya muestra (`qaRun` en `index.html`), con los límites de D3 (20 ítems por check, 200 caracteres por ítem, 16 KB por registro validados en el servidor). Checks nunca corridos quedan `not_run`; si un run falla, sus checks vuelven a `not_run` en vez de conservar un resultado viejo.
> - **`pageUrl` es obligatorio** (la columna es `NOT NULL`) y sale del campo Target URL. La nota opcional se guarda como `NULL` cuando está vacía y se limita a 2000 caracteres.
> - **`task_id` se guarda en mayúsculas** y se rechaza con 400 todo lo que no sea una letra, guion y números (D22).
> - **F2 no escribe `qa_record_bugs` ni los conteos D21**: siguen en 0 y vacíos hasta que F5 cierre el registro. Los llamadores de `insertBugs` llegan en F5 (`source: 'tool'` para los hallazgos automáticos) y en el checklist manual.
> - `test/routeInventory.test.js` no se tocó: detecta la ruta nueva solo y exige 401 sin sesión.
>
> Revisión de Claude Code (2026-11-10), corregido en esta fase:
> - **Task ID con una sola letra** (D22): `DA-174735` ahora responde 400 (RED → GREEN en `qaRecordsApi.test.js`).
> - **Resumen legible** (D32): cada check guarda `result` con la misma línea que muestra su panel; H1 guarda además `found` (los H1 y el sr-only que vio). Cada hallazgo es `{ bugId, device, text }`: texto CRIT-01, doble H1 FAIL-10, link sin 200 FAIL-06 (con su texto, código y URL), link absoluto FAIL-05, link pedido que falta FAIL-07, alt FAIL-04, title FAIL-03, anchor sin destino FAIL-08, anchor mal configurado FAIL-09. Los hallazgos de H1 sin un ID único de `BUGS.md` (sin H1, H1 distinto del sr-only, H1 mobile distinto) van con `bugId: null` para que el Shadow los clasifique.
> - **FAIL-05 solo para URLs absolutas del sitio del dealer**: el badge ABS de la tabla también marca links externos, `mailto:` y `tel:`, que según `BUGS.md` no son bug.
> - **Resumen compacto** (pedido de la usuaria, 2026-11-10): texto desktop y mobile guardan **solo la línea de resumen** del panel (`INCOMPLETE — CO lines: 18, present: 15, missing: 3`) como un único hallazgo CRIT-01, sin las líneas faltantes; links pedidos guardan solo los que faltan (`/new-inventory/index.htm — NOT FOUND`, FAIL-07). Cada hallazgo lleva también `type` y `severity` de la tabla Summary de `BUGS.md` (`{ bugId, type, severity, device, text }`).
> - **Dispositivo** (D23): `M` en los hallazgos del análisis mobile (texto mobile, H1 mobile distinto); `D` en el resto.
> - El servidor valida `result` (texto de hasta 200 caracteres) y `found` (mismos límites que `items`). `npm test`: 141/142; el único fallo es el `EPIPE` intermitente de `create-admin.test.js`, que aparte pasa 4/4.

---

## Fase 3: Vista del QA Engineer

**Objetivo:** que el QA Engineer vea sus tasks del mes y corrija el Task ID (paso 4).

**Archivos:**
- `src/services/qaRecordService.js`, `src/controllers/qaRecordController.js`, `src/routes/qaRecordRoutes.js`
- `public/my-qa.html`, `public/my-qa.js` (y un link en la barra de `index.html`)
- `test/qaRecordsApi.test.js`

**Tareas:**
- [x] `GET /api/qa-records/mine`: solo los registros cuyo owner es el usuario, del día 1 al último día del mes en curso **en hora de Bolivia** (D13), por fecha de guardado.
- [x] El Engineer solo puede **ver** su QA y **editar el Task ID**; la nota para el Shadow y el resumen no se editan (D12).
- [x] `PATCH /api/qa-records/:id` para cambiar el Task ID, solo si es del usuario.
- [x] Task ID nuevo ya existente → **409**, sin cambios.
- [x] Registro cerrado → **409**, sin cambios.
- [x] Pantalla con la lista y la edición del Task ID.
- [x] "Mis QA" funciona igual para `qa_engineer` y `qa_shadow` (D5).
- [x] Botón **"Ver"** en cada fila (D33): muestra el resumen de la herramienta por sección (`result` y hallazgos `bugId · type · severity · device · text`) y la nota para el Shadow. Sin la revisión del Shadow (D10) ni PDF (F6).

**Criterios de aceptación:**
- Un usuario nunca ve ni edita registros de otro (403 o 404).
- Un `qa_shadow` ve sus propios QA en "Mis QA".
- Los registros de otros meses no aparecen.
- Las dos condiciones de bloqueo responden 409 y dejan el registro igual.

**Prueba manual:**
1. Con dos usuarios `qa_engineer`, guardar un QA con cada uno.
2. Entrar con el primero a "Mis QA": solo aparece el suyo.
3. Editar el Task ID a uno libre → se actualiza. Editarlo al Task ID del otro usuario → bloqueado.
4. Después de F5: cerrar el QA como Shadow y comprobar que ya no se puede editar.

> Hecho el 2026-11-12. Decisiones de implementación:
> - **El mes de Bolivia se calcula en el servicio** (`boliviaMonthRange`, exportada): `now - 4h` y se leen los campos UTC → ventana `[día 1 04:00 UTC, día 1 del mes siguiente 04:00 UTC)`. Se pasa como `Date` al repository (el pool usa `timezone: 'Z'`), así el límite es exacto aunque el servidor no esté en UTC.
> - **Dueño desconocido o registro ajeno = 404 `not_found`** (la aceptación permite 403 o 404): no se filtra si el id existe.
> - **`PATCH` acepta solo `taskId`**; cualquier otro campo (note, summary…) → 400, así D12 queda garantizado en el servidor. Mismo `taskId` que el actual → **200 sin tocar nada** (no es un 409 contra sí mismo).
> - **Códigos:** `task_id_exists` (409 duplicado), `record_closed` (409 cerrado), `validation_error` (400). Los dos 409 se verifican en el servidor y dejan la fila igual.
> - **`closedAt` entró a `toQaRecordShape`** (lista y POST) para que la pantalla pinte Open/Closed y oculte el editor; sigue sin exponer checklist/status/comment, que llegan en F6.
> - **`qa_shadow` en "Mis QA" queda cumplido por construcción:** las rutas no tienen guardia de rol, solo sesión (mismo criterio que F2). El rol `qa_shadow` recién existe en F4, así que todavía no hay con quién probarlo.
> - **Pantalla:** `public/my-qa.html` + `my-qa.js` reutilizan las clases `admin-*`; link **"Mis QA"** en la barra de `index.html`. En `styles.css`: `input[type="text"]` suma los estilos de `admin-card`, y clases nuevas `.admin-badge--closed` y `.myqa-task-id`.
> - **Tests:** 8 nuevos en `test/qaRecordsApi.test.js` (18 en total): sesión, mes de Bolivia con los dos bordes (dentro del día 1 a las 04:00 UTC y fuera un milisegundo antes), edición del owner, 400 de formato y de campo desconocido, 404 ajeno, 409 duplicado, 409 cerrado y la pantalla estática. RED → GREEN. **Suite: 150/150.**
> - **Corrección en la revisión (Claude Code):** `pageUrl` solo acepta URLs `http(s)` (400 si no), porque se muestra como link en "Mis QA" y luego en las vistas del Shadow y del Admin: una URL `javascript:` sería XSS. `my-qa.js` además arma el link solo si es `http(s)`.

---

## Fase 4: Rol QA Shadow asignado por semana

**Objetivo:** que la Admin asigne el rol QA Shadow cada semana a la persona que le indican (paso 5, D1 y D6).

**Archivos (D1: rol nuevo):**
- `db/migrations/006_add_qa_shadow_role.sql` (`ALTER TABLE users MODIFY role ENUM('admin','qa_engineer','qa_shadow')`) — *renumerada: 005 quedó para `qa_record_bugs` (F1)*
- `src/services/adminUserService.js` (`USER_ROLES`)
- `public/admin-users.html`, `public/admin-users.js` (opción `qa_shadow` en el selector de rol)
- `src/middleware/requireRole.js` (reutilizado para las rutas Shadow) y `requireAdminPage` o una guarda equivalente para `shadow.html`
- `test/adminUsersApi.test.js`, `test/qaRecordsShadow.test.js`

**Tareas:**
- [x] Agregar `qa_shadow` al `ENUM` de roles y a `USER_ROLES`.
- [x] En la pantalla de usuarios, la Admin cambia el rol a `qa_shadow` y de vuelta a `qa_engineer` cuando termina la semana (la pantalla ya edita el rol con `PATCH /api/admin/users/:id`).
- [x] Guarda en el servidor: sin rol `qa_shadow` → 403 en las rutas y la página del Shadow.
- [x] Mantener las guardas existentes (no quedarse sin admin activo, no cambiarse el rol a sí misma).
- [x] Se pueden asignar varios `qa_shadow` a la vez (D9).
- [x] Al quitarle el rol `qa_shadow` a alguien, borrar en la misma transacción sus revisiones sin cerrar; esos QA vuelven a pendientes (D9). Las revisiones ya cerradas no se tocan.

**Criterios de aceptación:**
- Solo Admin puede cambiar el rol.
- Un usuario sin rol `qa_shadow` recibe 403 aunque escriba la URL.
- Al volver el rol a `qa_engineer`, pierde el acceso Shadow en el siguiente request y sus revisiones sin cerrar desaparecen.

**Prueba manual:**
1. Como Admin, cambiar a dos usuarios a `qa_shadow`.
2. Entrar con cada uno → ven la vista Shadow. Entrar con un `qa_engineer` → 403.
3. Con uno de ellos, empezar a revisar un QA sin cerrarlo. Volverle el rol a `qa_engineer` → pierde el acceso y ese QA vuelve a pendientes sin lo que había cargado.

> Hecho el 2026-11-16. Decisiones de implementación:
> - **Migración 006** (`db/migrations/006_add_qa_shadow_role.sql`): un solo `ALTER TABLE users MODIFY role ENUM('admin','qa_engineer','qa_shadow') NOT NULL`, sin DROP (producción migra como `qa_migrator`). `qa_shadow` se agrega **al final** del ENUM: insertarlo en el medio renumeraría los valores que siguen.
> - **`USER_ROLES`** pasa a `['admin','qa_engineer','qa_shadow']` y es la lista con la que el servidor valida; el selector de rol de `admin-users` (alta y fila) suma la opción `qa_shadow`. El alta y el cambio de rol siguen yendo por `POST`/`PATCH /api/admin/users`.
> - **Página del Shadow:** `public/shadow.html` mínima — topbar (Tool, Change password, Logout) y un aviso de que la cola de pendientes y el formulario llegan en F5, sin `shadow.js`. Se protege con `requirePageRole('qa_shadow', ['/shadow.html'])`, montada al lado de la guarda de admin en `src/app.js`. `requireAdminPage` quedó como caso particular de `requirePageRole` (mismo HTML y mensaje de 403 para admin), así F5 solo agrega `/shadow.js` a esa lista.
> - **Guarda de API:** F4 no monta rutas nuevas (la vista real es F5). El contrato queda probado con `requireRole('qa_shadow')` corriendo en un servidor HTTP real dentro de `qaRecordsShadow.test.js`: 401 sin sesión (default deny, antes que 403), 403 `forbidden` con `qa_engineer` o `admin`, `next()` con `qa_shadow`. F5 monta esa misma guarda en las rutas Shadow.
> - **Vigencia del rol sin re-login:** `sessionMiddleware` lee `users` en **cada** request, así que el cambio de rol se aplica en el siguiente request con la misma cookie. Probado en los dos sentidos: 403 → (PATCH a `qa_shadow`) → 200 → (PATCH a `qa_engineer`) → 403, con `GET /api/auth/me` devolviendo 200 y el rol nuevo todo el tiempo.
> - **D9 en la misma transacción:** `updateUser` abre transacción cuando el rol **sale** de `qa_shadow` y, antes del commit, `qaRecordRepository.releaseShadowReviews` borra los `qa_record_bugs` con `source='manual'` de los registros **abiertos** de ese revisor (`closed_at IS NULL`) y pone `reviewer_id`, `checklist`, `qa_comment` y `qa_status` en NULL. El DELETE va antes que el UPDATE porque el subconsulta lee `reviewer_id`. Los cerrados y los de otros Shadows no se tocan; los hallazgos `source='tool'` sobreviven (salen del run, no del revisor).
> - **Solo la baja dispara la limpieza:** un rename, un PATCH con el mismo rol, o bajar el rol de un usuario que no es `qa_shadow` no ejecutan `releaseShadowReviews`. ~~Desactivar una cuenta tampoco (pide "al quitarle el rol").~~ **D34 (F5, 2026-11-21) la excepción:** desactivar (`isActive: false`) a un `qa_shadow` **activo** sí la ejecuta, en la misma transacción; ver F5.
> - **Atomicidad:** vive en el código (una transacción, rollback si falla cualquiera de los dos pasos); los tests no fuerzan un fallo a mitad de camino, solo verifican el resultado conjunto.
> - **Tests RED → GREEN:** `test/adminUsersApi.test.js` (3) — alta y cambio a `qa_shadow`, dos Shadow a la vez, y guardas admin vigentes (`self_change` con dos admins, `last_admin` con uno solo, 403 de todo el API para un Shadow). `test/qaRecordsShadow.test.js` (5) — página 302/403/403/200, guarda de API, siguiente request sin re-login, D9 completo (lo abierto se limpia, lo cerrado y lo de otros queda intacto, `tool` sobrevive) y "D9 solo al bajar el rol". `migrate.test.js` suma 006 y verifica el ENUM; `routeInventory.test.js` trata `shadow.html` como gated y por eso agrega un usuario `qa_shadow` a su seed. **Suite: 159/159.**
> - `npm run migrate` aplicó 006 y es no-op al repetirlo.

---

## Fase 5: Vista del QA Shadow y cierre

**Objetivo:** buscar, revisar, completar y cerrar QA (paso 6).

**Archivos:**
- `src/services/qaRecordService.js`, `src/controllers/qaRecordController.js`, `src/routes/qaRecordRoutes.js`
- `public/shadow.html`, `public/shadow.js`
- `test/qaRecordsShadow.test.js`

**Tareas:**
- [x] D34: desactivar a un `qa_shadow` (`isActive: false`) libera sus QA abiertos igual que quitarle el rol (D9), en la misma transacción (`adminUserService`, `releaseShadowReviews`).
- [x] Guarda atómica del cambio de Task ID (pendiente de la revisión de F3): el `UPDATE` de `qaRecordRepository.updateTaskId` filtra `owner_id = ? AND closed_at IS NULL` y revisa `affectedRows`, para que un cierre simultáneo no deje editar un QA cerrado.
- [x] `GET /api/qa-records`: lista de los QA **pendientes de revisar** de otras personas, con su owner; los propios no aparecen (D5).
- [x] Búsqueda por Task ID (un Task ID propio no aparece en los pendientes).
- [x] Los QA cerrados salen de la lista de pendientes, los haya cerrado quien sea (D14).
- [x] **Historial del Shadow:** lista de los QA que él revisó y cerró, con búsqueda por Task ID (D14).
- [x] Mostrar la nota que dejó el Engineer al guardar (D12). *(servidor: `note` viaja en cada fila de la cola; el render es la parte 2)*
- [x] Ítems del checklist manual tomados de `BUGS.md` (D15); el "QA Todo List" de `index.html` no se toca. *(servidor: catálogo + validación; el formulario es la parte 2)*
- [x] Botón **"Tomar"**: asigna el QA al Shadow de forma atómica (`UPDATE ... WHERE reviewer_id IS NULL`); si otro lo tomó antes → 409 (D10). *(el botón es la parte 2; la ruta `POST /:id/take` ya resuelve)*
- [x] Un QA tomado sale de los pendientes de los demás Shadows; solo quien lo tomó puede editarlo y cerrarlo (403 para los demás).
- [x] Guardar el avance de la revisión sin cerrar, a nombre del Shadow (lo que se borra en D9, que además libera el QA).
- [ ] Formulario con QA Comment, QA Status y checklist manual (Passed / Bug / N/A por ítem). Sin QA Link (D2). — **parte 2 (pantalla)**
- [x] El campo "QA Shadow" se guarda con el usuario de la sesión (D6); no se elige a mano.
- [x] Al cerrar, calcular el estado final y generar el comentario con la tabla de criterios de F0 (D7), a partir de los hallazgos automáticos (resumen D3) y del checklist manual.
- [x] Tabla de bugs en un solo lugar: el servidor tiene el catálogo de `BUGS.md` (ID → tipo y severidad) y toma el tipo y la severidad de ahí al cerrar. Hoy `QA_BUG_INFO` de `public/index.html` (F2) los copia para etiquetar los hallazgos; F5 deja de depender de esa copia.
- [x] El Shadow puede editar el status y el comentario generados antes de confirmar el cierre (D8). *(servidor: `qaStatus`/`qaComment` opcionales en el cierre; el formulario es la parte 2)*
- [x] Botón **"Cerrar QA"**: después del cierre no se puede editar nada (409 en cualquier cambio). *(el botón es la parte 2; la guarda ya responde 409)*
- [x] Revisar o cerrar un QA propio → 403 (D5).

**Criterios de aceptación:**
- Solo el rol `qa_shadow` usa estas rutas.
- La lista de pendientes y la búsqueda nunca devuelven QA cuyo owner es el Shadow.
- Si dos Shadows toman el mismo QA a la vez, solo uno lo consigue; el otro recibe 409.
- El registro cerrado guarda como QA Shadow al usuario que cerró.
- El estado y el comentario generados coinciden con la tabla de criterios para los casos de prueba de F0.
- Después de cerrar, cualquier edición (Shadow o Engineer) responde 409.

**Prueba manual:**
1. Con rol `qa_shadow`, buscar un Task ID guardado por un Engineer → aparecen sus datos sin volver a correr la herramienta.
2. Buscar un Task ID que el Shadow guardó en una semana anterior → no aparece.
3. Completar el checklist, ver el estado y el comentario propuestos, editar los dos y cerrar.
4. Intentar editar otra vez (como Shadow y como Engineer) → bloqueado.

> **Parte servidor hecha el 2026-11-21** (la pantalla `shadow.html`/`shadow.js` queda para la parte 2). Decisiones de implementación:
> - **Rutas** (`src/routes/qaRecordRoutes.js`): `GET /` (cola + `?taskId=`), `GET /history` (`?taskId=`), `POST /:id/take`, `PATCH /:id/review` y `POST /:id/close` van detrás de `requireRole('qa_shadow')`; `POST /`, `GET /mine` y `PATCH /:id` siguen **sin guarda de rol** (D5), sin cambios. `/history` se registra antes de cualquier `/:id` (F6 agregará `GET /:id`).
> - **Cola** (D5/D10/D14): `WHERE closed_at IS NULL AND owner_id <> yo AND (reviewer_id IS NULL OR reviewer_id = yo)` — el QA que tomé sigue visible para mí y sale de los demás; los cerrados salen de todos. Trae `ownerFullName` (JOIN con `users`) y el `note` del Engineer (D12). La búsqueda es `task_id = ?` exacto con el Task ID en mayúsculas (D22); mal formado → 400.
> - **Historial** (D14): `WHERE reviewer_id = yo AND closed_at IS NOT NULL`, el más reciente primero, con la misma búsqueda.
> - **Atómico, sin lectura previa** (como pidió la fase): `take` = `UPDATE ... WHERE id = ? AND reviewer_id IS NULL AND closed_at IS NULL AND owner_id <> ?`; `review` y `close` = `WHERE id = ? AND reviewer_id = ? AND closed_at IS NULL`. Con `affectedRows = 0` la clasificación se hace con una lectura posterior: 404 inexistente, 403 propio (D5), 409 `record_closed`, 403 ajeno, 409 `not_taken` (hay que tomarlo primero), 409 `already_taken`. Un `take` repetido del mismo Shadow es idempotente (200).
> - **Guardar avance y cerrar comparten transacción** con sus filas de `qa_record_bugs` (`withReviewWrite`): o se guarda todo o nada, así el registro y sus bugs nunca quedan a medias. Se reemplazan solo las filas de la fuente que toca (`manual` en el avance, `manual` + `tool` al cerrar).
> - **Formato del avance:** `checklist` = mapa ítem → `passed` / `bug` / `n/a` con los 12 ítems de F0 (parcial en el avance, completo en el cierre, D24); `bugDevices` = mapa ítem → `M` / `D` / `M/D`, **obligatorio para cada ítem marcado `bug`** (D21); `qaStatus` y `qaComment` opcionales como borrador del cierre (D8) — por eso `releaseShadowReviews` (D9) limpia esas dos columnas.
> - **Cierre:** los bugs entran en este orden — hallazgos del resumen con `bugId` que el catálogo conoce (en el orden de los checks) y después los ítems manuales en orden F0 — que es exactamente el orden de inserción en `qa_record_bugs`, así el comentario (D20) y los `qa_record_bugs` coinciden. Los hallazgos con `bugId: null` (los casos de H1 sin id único de F2) **no entran** al status ni al comentario: no tienen fila en la tabla de criterios. Estado D21/D25 (`Passed` sin comentario si no hay bugs), `qaStatus`/`qaComment` del cuerpo los reemplazan (D8), conteos en las tres columnas, `closed_by` = `reviewer_id` = usuario de la sesión (D6).
> - **Catálogo nuevo:** `src/services/qaBugCatalog.js` con `QA_BUGS` (los 21 bugs de `BUGS.md`: nombre, tipo, severidad), `MANUAL_CHECKLIST` (los 12 de F0) y los tres builders (`manualBugsFromChecklist`, `toolBugsFromSummary`, `statusAndCommentFromBugs`). Tipo y severidad salen **siempre** del catálogo, nunca del payload: la copia `QA_BUG_INFO` del navegador queda solo para etiquetar la pantalla (F2).
> - **Validación antes que estado:** un payload inválido responde 400 aunque el registro esté cerrado; el 409 aplica a ediciones con forma válida (los tests usan un payload válido para probar los 409/403).
> - **D34:** `isActive: false` sobre un usuario `qa_shadow` **activo** dispara `releaseShadowReviews` en la misma transacción del PATCH (junto con la revocación de sesiones); no cambia el rol, y una re-activación o la desactivación de un que no es Shadow no la dispara.
> - **`updateTaskId` atómico:** el `UPDATE` filtra `owner_id = ? AND closed_at IS NULL` y devuelve `null` con `affectedRows = 0`; el servicio relee para responder 404 / 409 `record_closed` (o el no-op si otro guardó el mismo Task ID en el medio).
> - **Tests:** 13 nuevos en `test/qaRecordsShadow.test.js` (RED → GREEN), uno por criterio de aceptación: guarda de las 5 rutas, cola + búsqueda (propio/cerrado/ajeno tomado), historial, carrera de `take` (409 `already_taken`), avance (409/403/400 + bugs `manual`), cierre `Passed` sin comentario (D25), un bug manual (D20/D21), tool + manual con catálogo mandando sobre el payload, edición D8, D24 completo, bloqueo posterior al cierre con `closed_by`, D34 completo y la guarda de `updateTaskId`. **Suite: 172/172.**
> - **Abierto (parte 2):** D26/D27 — cómo persiste el servidor el N/A opcional sobre un hallazgo automático (hoy todo hallazgo con `bugId` cuenta) y la explicación del N/A del checklist (hoy el checklist guarda solo el estado). Ninguna tarea de F5 ni su aceptación lo piden; definirlo antes de armar el formulario.

---

## Fase 6: Resultado del QA cerrado para el Engineer y PDF

**Objetivo:** que la persona que hizo el QA vea el resultado del cierre y descargue el PDF (paso 7, D2).

**Archivos:** `public/my-qa.html`, `public/my-qa.js` (detalle del QA cerrado y PDF con `html2pdf`, como `downloadPDF()` de `public/index.html`), `src/routes/qaRecordRoutes.js` (`GET /api/qa-records/:id` del owner).

**Tareas:**
- [ ] En "Mis QA", abrir un QA cerrado y ver: resumen guardado (D3), checklist manual, QA Status y QA Comment del Shadow.
- [ ] Botón **"Descargar PDF"** visible solo en QA cerrados, generado en el navegador con los datos guardados.
- [ ] El owner solo puede ver sus propios QA (403/404 para los de otros).

**Criterios de aceptación:**
- Un QA abierto no ofrece la descarga; uno cerrado sí.
- Mientras el QA no está cerrado, la API del owner **no devuelve** los campos de la revisión (checklist, status, comment), aunque un Shadow lo tenga tomado (D10).
- El PDF muestra lo mismo que la pantalla: resumen, checklist, status y comment.

**Prueba manual:** cerrar un QA como Shadow, entrar como el Engineer que lo guardó, abrirlo en "Mis QA", ver la corrección y descargar el PDF.

---

## Fase 7: Descargas CSV

**Objetivo:** el resumen mensual para Admin y los QA cerrados para el Shadow (paso 8).

**Archivos:** `src/services/qaRecordService.js`, `src/controllers/qaRecordController.js`, `src/routes/qaRecordRoutes.js`, `public/admin-users.html` o una pantalla de Admin, `public/shadow.js`, `test/qaRecordsCsv.test.js`.

**Tareas:**
- [ ] **Vista del Admin, solo lectura:** lista completa de QA, sin editar, reabrir ni cambiar Task IDs (D17).
- [ ] `GET` CSV mensual, solo Admin, del mes indicado (en hora de Bolivia, D13); se puede bajar cuando quiera, también el mes en curso (D16).
- [ ] `GET` CSV del Shadow: **solo los QA que él revisó y cerró**, por día o por rango.
- [ ] Escapar comas, comillas y saltos de línea; proteger contra fórmulas en Excel (`=`, `+`, `-`, `@`).
- [ ] Definir columnas (Duda 1).

**Criterios de aceptación:**
- Un `qa_engineer` recibe 403 en el CSV de Admin.
- El CSV del Shadow no incluye QA abiertos ni cerrados por otro Shadow.
- El archivo abre bien en Excel con acentos (UTF-8).

**Prueba manual:**
1. Como Admin, descargar el CSV del mes y abrirlo en Excel.
2. Como Shadow, descargar el suyo: solo aparecen sus QA cerrados.

---

## Fase 8: Borrado mensual (día 10 del mes siguiente)

**Objetivo:** borrar los QA de un mes el día 10 del mes siguiente (paso 9, D4).

**Archivos:**
- `scripts/purge-qa-records.js` y un script en `package.json`
- `ops/` (un timer de systemd como el del backup)
- `README.md`, `db/README.md`
- `test/purge-qa-records.test.js`

**Tareas:**
- [ ] Desde el día 10 de cada mes, borrar los QA guardados **antes del día 1 del mes en curso**, ambos en hora de Bolivia (D13) (el 10/11 se borra octubre y queda noviembre).
- [ ] Programar una ejecución diaria en el VPS (timer de systemd como el backup de `ops/`): es idempotente y, si un día falla, el siguiente lo completa.
- [ ] Usar el usuario `qa_app` (tiene DELETE); nunca root.
- [ ] Documentarlo en el README.

**Criterios de aceptación:**
- El 9/11 todavía existen los QA de octubre; el 10/11 se borran y los de noviembre quedan.
- Correr el borrado dos veces seguidas no falla ni borra de más.
- La fecha "hoy" se puede inyectar en los tests.

**Prueba manual:**
1. En local, guardar un QA y cambiar a mano su `created_at` al mes anterior.
2. Correr el script simulando el día 9 → no borra. Simulando el día 10 → borra solo ese.

---


## Estado

| Fase | Estado | Commit |
|---|---|---|
| F0 Documento de bugs y tabla de criterios | completa: `BUGS.md` con tipos, checklist manual (D19, D28, D29), status (D21, D25) y comentario (D20) | — |
| F1 Tabla | completada 2026-11-07: migraciones 004 (qa_records) y 005 (qa_record_bugs), repository, 7 tests en verde; `npm run migrate` es no-op al repetir. Corrección 2026-11-07: 005 agregó `source ENUM('tool','manual')` (D9), bases locales sincronizadas. F4 pasa a la migración 006 | — (sin commit, a pedido) |
| F2 Guardar QA | completada 2026-11-10 y corregida en la revisión (D22 una letra, D32 resumen legible con `result`, `found` y hallazgos `{ bugId, device, text }`); 10 tests en `qaRecordsApi.test.js`; suite 141/142 (fallo intermitente `EPIPE` de `create-admin`, ajeno a F2) | — (sin commit) |
| F3 Vista Engineer | completada 2026-11-12: `GET /mine` (mes de Bolivia D13), `PATCH /:id` (solo owner, solo taskId), 404 ajeno, 409 duplicado y 409 cerrado, pantalla `my-qa.html`/`my-qa.js` con link "Mis QA" en `index.html`; 18 tests en `qaRecordsApi.test.js`, suite 150/150 | — (sin commit) |
| F4 Rol QA Shadow | completada 2026-11-16: migración 006 (ENUM con `qa_shadow`, sin DROP), `USER_ROLES` y selector de rol, `requirePageRole` para `shadow.html`, guarda `requireRole('qa_shadow')` para F5, D9 en la misma transacción; RED → GREEN, `npm run migrate` no-op al repetir, suite 159/159 | — (sin commit, a pedido) |
| F5 Vista Shadow y cierre | **servidor completado 2026-11-21**: 5 rutas con `requireRole('qa_shadow')`, cola/historial/búsqueda, `take`/`review`/`close` atómicos, catálogo `qaBugCatalog.js` (D7/D20/D21/D25), D8, D24, D34 y guarda de `updateTaskId`; 13 tests nuevos en `qaRecordsShadow.test.js` (RED → GREEN), suite 172/172; decisiones anotadas arriba. **Pantalla pendiente (parte 2)**: `shadow.html`/`shadow.js`. Dependencias F0 y F4 listas | — (sin commit, a pedido) |
| F6 Resultado y PDF para el Engineer | pendiente; decidido (D2) | — |
| F7 Vista Admin y CSV | pendiente; Duda 1 | — |
| F8 Borrado mensual | pendiente; decidido (D4) | — |

Orden sugerido: F1 a F4 completadas; sigue F5 (F5 espera F0 y F4, ambas listas).

## Dudas

Resueltas: D1 a D18 (2026-11-07) y D22 a D31 (2026-11-10). Ver Decisiones.

1. **Columnas de los CSV** (D31): la usuaria pasa la lista; los dos CSV usan las mismas columnas.
