# Handoff de revisión — T4 (usuarios y contraseñas)

Para: **Claude Code** (revisor).
Feature: `login-authentication` · Rama: `feature/login-authentication`.
Plan: `odd/tasks/login-authentication.md` (T4, specs S1, S5, S6, S10) · Diseño: `docs/auth/auth-architecture.md` §5.1.
Runner: `node --test`. Sin commits todavía: todo está en el working tree.

## Alcance de T4 (lo que se pidió)

> "**Usuarios y contraseñas**: `passwordService`, `userRepository`, `scripts/create-admin.js`
> (pide la contraseña por consola, sin argumentos visibles). Tests unitarios de hash,
> verificación, `needsRehash` y política."

Fuera de alcance (no implementado a propósito): login/sesiones/endpoints/middlewares/pantallas
(T5+), API de administración de usuarios (T9), pantalla de admin (D6).

## Cambios realizados

| Archivo | Estado | Qué hace |
|---|---|---|
| `src/services/passwordService.js` | nuevo | `hash`, `verify`, `needsRehash`, `validatePolicy`, `verifyDummy`, `SCRYPT_PARAMS`. scrypt de `node:crypto` con `N=2^17, r=8, p=1, keylen=64, maxmem=256MiB` y salt aleatorio de 16 bytes (§5.1). Stored autocontenido `scrypt$N=131072,r=8,p=1$<salt_b64>$<hash_b64>`. Comparación con `timingSafeEqual`. Al parsear un stored se rechazan parámetros fuera de tope (`N>2^20`, `r>32`, inválidos) para que una fila manipulada no dispare memoria infinita. Política: 12–128 caracteres (code points), difiere de la actual, sin reglas de composición; `verifyDummy()` quema el mismo trabajo scrypt y siempre devuelve `false` (timing uniforme, §5.1). |
| `src/repositories/userRepository.js` | nuevo | SQL plano con `pool.execute` (prepared statements, sin ORM, §2). **Pool explícito como parámetro** en cada función (sin global oculto; los tests apuntan la misma función a la base de test). `normalizeEmail` (trim+lowercase, §4.1), `create`, `findById`, `findByEmail`, `countActiveAdmins`. `create` setea `password_changed_at/created_at/updated_at` con el `now` del caller y `last_login_at NULL`. |
| `scripts/create-admin.js` | nuevo | CLI de bootstrap/emergencia (§3). Pregunta email, nombre y contraseña **por consola con input oculto, sin argumentos visibles**. Se **niega si ya existe un admin activo** (el resto se creará con la API admin, T9). Valida formato de email, nombre no vacío, política de contraseña y que las dos entradas coincidan. Crea `role='admin'`, `must_change_password=0`, `created_by=NULL`, UUID v4. Errores con mensaje claro y exit 1. |
| `package.json` | modificado | Script `"create-admin"`. `test` ahora usa `--test-concurrency=1` (ver "Nota de runner"). |
| `test/passwordService.test.js` | nuevo | 7 unit tests sin DB: formato §5.1, salt único, verify correcto/incorrecto, verify con stored tamperado/malformado, `needsRehash` (fresh=false, params débiles=true, garbage=true), política (límites 12/128, sin composición, same_as_current), `verifyDummy` siempre false. |
| `test/userRepository.test.js` | nuevo | 4 integración con `TEST_DB_*` (migraciones idempotentes antes, `DELETE FROM users` entre tests): create+findById con campos exactos, email guardado normalizado y lookup case-insensitive, `ER_DUP_ENTRY` en email duplicado, `countActiveAdmins` ignora inactivos y no-admins. |
| `test/create-admin.test.js` | nuevo | 3 E2E del CLI (proceso hijo con `DB_*` apuntando a la base de **test**): (1) crea el primer admin por stdin tubería y la fila quedа con rol admin/`must_change_password=0`/`created_by NULL` y la contraseña verifica contra el hash; (2) se niega con exit 1 si ya hay un admin activo y no crea nada; (3) rechaza contraseña de 11 caracteres con `password_too_short` sin crear usuario. |
| `db/README.md` | modificado | §5: conteos actualizados (25 con `TEST_DB_*`; 14+11 sin) y nota de corrida secuencial. |
| `odd/tasks/login-authentication.md` | modificado | Fila T4, Log L14, cabecera de estado. |

## Resultado de pruebas

```
con TEST_DB_* (qa_migrator sobre api_to_do_qa_test)  →  25 passed, 0 failed, 0 skipped
sin TEST_DB_* (default seguro)                       →  14 passed, 0 failed, 11 skipped
```

RED observado antes de implementar: `ERR_MODULE_NOT_FOUND: src/services/passwordService.js`.
Cobertura nueva: 7 unit (passwordService) + 4 integración (userRepository) + 3 E2E (CLI).

Verificación manual adicional: el CLI corrió a mano con stdin tubería contra
`api_to_do_qa_test` (exit 0, fila creada y verificada, base limpiada después).

## Nota de runner (`--test-concurrency=1`)

`node --test` corre archivos en paralelo por defecto. Los archivos de integración comparten
**una** base de test y `migrate.test.js` dropea y recrea las tablas: en paralelo había carreras
(la primera ejecución completa se colgó). Los tests ahora corren en serie; costo: ~12 s con
`TEST_DB_*`. Alternativa futura: una base por archivo.

## Decisiones técnicas para tu revisión (candidatas a blocking)

1. **`must_change_password = 0` en el admin de CLI.** El diseño §5.5 obliga a cambiar la
   contraseña cuando un admin la *setea* (temporal). Aquí la persona elige su propia contraseña
   en la CLI, así que forzar un cambio inmediato no aporta. T6 respetará esto para el flujo
   `must_change_password`.
2. **La CLI se niega si ya hay un admin activo** (mensaje: use la API admin). Cubre bootstrap y
   emergencia (usuarios existentes sin admin activo) sin ambigüedad. Si preferís que la emergencia
   pida una confirmación extra, es un ajuste de 5 líneas.
3. **`verifyDummy` con salt constante** (no aleatorio): su único papel es consumir tiempo; nunca
   se almacena ni se compara. Si querés salt aleatorio por principio, no cambia el comportamiento.
4. **Pool explícito en los repos** en vez de singleton global (testeable, sin efectos en import).
5. **Tops defensivos al parsear el stored** (`N≤2^20`, `r≤32`): una fila corrupta devuelve
   `verify=false` en vez de intentar derivar con parámetros absurdos.

## Riesgos y pendientes

- **Risk T4 (item 2):** credenciales. scrypt con parámetros OWASP, sin dependencias nuevas;
  `timingSafeEqual`; política NIST; input oculto; sin secretos en el repo ni en argv.
- El hash es CPU-caro a propósito (~0.5 s por login con N=2^17). Es el costo esperado; el brute
  force queda acotado además por `login_attempts` (T5).
- Los tests de integración **solo** con `TEST_DB_*`; sin ellos hacen skip. La base de desarrollo
  `api_to_do_qa` **no** se toca en los tests. El CLI todavía no se corrió contra la base de
  desarrollo: crear el primer admin real queda para cuando lo decida la usuaria.
- `qa_migrator` local tiene DROP en ambas bases (setup previo de T3); el doc §3 ya no lo pide.
  Inconsistencia conocida, no afecta a T4.
- Pendiente previo no bloqueante: `SELECT VERSION();` en phpMyAdmin de Hostinger (§8.1).

## Qué se pide revisar

1. Que T4 cubra S1, S5, S6 y S10 sin salirse del alcance (S1 a nivel CLI; la API admin es T9).
2. `passwordService`: parámetros, formato, `timingSafeEqual`, parseo defensivo y política.
3. `create-admin`: flujo, input oculto, negación con admin activo y manejo de errores.
4. `userRepository`: SQL, normalización de email y firmas con pool explícito.
5. Las 5 decisiones técnicas de arriba (especialmente `must_change_password=0`).
6. La nota del runner (`--test-concurrency=1`) y la calidad de los tests.

Tras el **aprobado**, se hará un commit Conventional en `feature/login-authentication` y push
solo a esa rama. Sin merge, rebase, PR ni cambios en `main`.
