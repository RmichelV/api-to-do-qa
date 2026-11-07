# QA API Tester: Guardado de QA y vista QA Shadow

### Objetivo

Guardar un resumen liviano de cada QA por task, para que el QA Shadow pueda buscarlo, revisarlo y cerrarlo con el status final sin volver a correr todo.

### Roles

- **Admin:** cada semana asigna el rol QA Shadow a la persona que le indican, desde la pantalla de usuarios, y lo cambia cuando termina la semana. Descarga el resumen mensual. **Solo ve** la lista completa de QA: no edita ni reabre.
- **QA Engineer:** corre la herramienta sobre su task y guarda el QA.
- **QA Shadow:** es un rol propio que cambia cada semana y **puede haber más de uno a la vez**. Revisa los QA guardados, hace la validación manual y cierra el QA. También puede guardar sus propios QA y verlos, pero **no puede revisarse a sí mismo**: sus QA no le aparecen en los pendientes para revisar. Cuando el Admin le quita el rol, se borran sus revisiones pendientes (las que no cerró).

### Flujo del QA Engineer

1. Corre la herramienta sobre su task y corrige lo que encuentre.
2. Al terminar, presiona **“Guardar QA”** una sola vez. No se guarda cada vez que se corre la herramienta.
3. Se guarda con el **Task ID** y, si quiere, una **nota para el QA Shadow** (por ejemplo, alguna especificación especial), que le aparece al QA Shadow. No se guardan todos los datos de la corrida, solo el resumen.
   - El Task ID es una letra, un guion y números, por ejemplo `D-174735`. Lo da el sistema, es único y nunca se repite.
   - Después de guardar, el QA Engineer solo puede ver su QA y editar el Task ID.
4. Se puede guardar aunque tenga bugs, porque después lo revisa el QA Shadow.
5. Si ya existe un QA guardado con ese Task ID, **no se puede guardar otro encima**.

#### Vista del QA Engineer

- Ve la lista de **sus** tasks del mes, del día 1 al último día del mes. El mes se corta en **hora de Bolivia**.
- Desde esa lista puede **editar el Task ID** si lo guardó mal.
- Si el nuevo Task ID ya existe, el cambio se bloquea, para que no haya dos tasks iguales.
- Una vez que el QA Shadow cierra el QA, ya no se puede editar.
- Cuando el QA está cerrado, ve el resultado de la revisión (QA Status, QA Comment y checklist manual) con las correcciones que le levantaron, y puede descargar el PDF.

### Flujo del QA Shadow

1. Toma una task desde Smartsheet.
2. Antes de hacer el QA, **busca el Task ID** en la herramienta.
3. Si ya está guardado, toma esos datos y hace la comprobación final. No vuelve a correr la herramienta.
4. Completa la validación manual y sus campos.
5. **Cierra el QA.** Ahí termina todo y ya no se puede editar nada más.

#### Vista del QA Shadow

- Ve la lista de **los QA pendientes de revisar de otras personas**, con su owner. Sus propios QA no aparecen en esa lista, y los QA ya cerrados (por él o por otro QA Shadow) salen de ella.
- Tiene un **historial** con los QA que él revisó.
- En la lista de pendientes y en el historial se busca por Task ID.
- Ve la nota que dejó el QA Engineer al guardar.
- Cuando toma un QA, queda bloqueado para él: desaparece de los pendientes de los demás QA Shadow y solo él puede terminarlo.
- El owner del QA ve la revisión del QA Shadow en su perfil, junto con sus QA, **solo cuando está cerrada**; antes no.

#### Campos que completa el QA Shadow

- **QA Shadow:** quién hizo la revisión. Es el usuario con el rol QA Shadow asignado por el Admin esa semana.
- **QA Comment**
- **QA Status**
- **Checklist de validación manual**

Estos campos se guardan en el resumen final y los ve el QA Engineer que hizo el QA.

### Checklist de validación manual

- Solo incluye lo que **no** revisa la herramienta. Lo automático no se repite en el checklist.
- No todas las páginas tienen lo mismo, pero el checklist se agrega igual.
- Cada ítem tiene tres opciones: **Passed / Bug / N/A**.

### Status del task

- Opciones: **Passed / Opportunity / Failed / Critical**.
- Lo que detecta la herramienta y lo que se revisa en el checklist manual entran en la clasificación para saber el estado final.
- La clasificación se basa en el documento de bugs: una tabla de criterios que dice a qué estado corresponde cada bug. Esa tabla se usa al cerrar el QA para categorizar el estado final y para generar el comentario.
- El QA Shadow da el criterio final: puede editar el status y el comentario generado al cerrar el QA.
- Si hay un solo bug, el status es su severidad (por ejemplo, `Critical`). Si hay más de uno, se muestra el conteo por severidad: `Critical (1), Failed (2), Opportunity (1)`. Sin bugs, `Passed`.
- El comentario tiene una línea por bug: `Dispositivo / Tipo / Severidad / Descripción`, por ejemplo `M/D / Styling / Failed / Cropped images` (`M/D` = mobile y desktop). En la parte manual, el QA Shadow elige en qué dispositivo está cada bug. El tipo de cada bug está en `BUGS.md`.

### Descargas (CSV)

- **Admin:** descarga el CSV cuando quiera. El resumen de todo el mes lo baja al terminar el mes: tiene hasta el día 9 del mes siguiente, antes del borrado.
- **QA Shadow:** descarga cuando quiera (por día o cuando necesite), pero **solo los QA que ya revisó y cerró**.

### Retención de datos

- Los QA de un mes se guardan todo ese mes y se borran el **día 10 del mes siguiente** (esos 10 días son cuando se revisan).
- Ejemplo: lo de octubre se guarda todo el mes hasta el 10 de noviembre, que se borra solo lo de octubre; noviembre queda hasta el 10 de diciembre.
- Se borra para no sobrecargar la base de datos.

### Pasos a seguir

1. **Documento de bugs (pendiente):** armar la tabla y clasificar cada bug como “lo detecta la herramienta” o “manual”.
2. **Clasificación de errores (pendiente):** tabla de criterios que define qué hallazgos (automáticos y manuales) son Passed, Opportunity, Failed o Critical, usada al cerrar el QA para el estado final y el comentario.
3. **Botón “Guardar QA”** con Task ID, un solo registro por Task ID.
4. **Vista del QA Engineer:** sus tasks del mes y la edición del Task ID, con bloqueo de duplicados y sin edición después del cierre.
5. **Rol QA Shadow** que el Admin asigna cada semana desde la pantalla de usuarios.
6. **Vista del QA Shadow:**
   - lista de los QA de otras personas con su owner y búsqueda por Task ID
   - checklist manual, QA Comment y QA Status
   - botón para cerrar el QA
7. **Resultado y PDF para el QA Engineer** una vez cerrado el QA.
8. **Descargas CSV:** el resumen mensual para Admin y los QA cerrados para el QA Shadow.
9. **Borrado automático** el día 10 de cada mes, de los QA del mes anterior.
