# QA API con Node.js y Playwright

Este proyecto es una API REST diseñada para realizar tareas de QA automatizado utilizando Playwright.
El objetivo es analizar, limpiar y verificar contenido web.

## Objetivos del Estudiante
1. Aprender a estructurar un proyecto backend profesional con Node.js.
2. Implementar arquitectura por capas (Controladores, Servicios, Rutas).
3. Integrar Playwright para scraping y testing.

## Comandos Útiles (Multiplataforma)

Esta guía sirve para macOS, Linux y Windows (usando PowerShell o Git Bash).

### Instalación y Ejecución

1.  **Instalar dependencias:**
    ```bash
    npm install
    ```
2.  **Iniciar modo desarrollo (con auto-reload):**
    ```bash
    npm run dev
    ```
3.  **Iniciar modo producción:**
    ```bash
    npm start
    ```

### Historial de Comandos de Inicialización

Estos comandos ya se ejecutaron, pero quedan como referencia:

1.  **Crear e iniciar proyecto:**
    ```bash
    npm init -y
    mkdir -p src/controllers src/routes src/services src/utils
    ```
    *(En Windows CMD usar `mkdir src\controllers`, etc.)*

2.  **Instalar Express (Servidor Web):**
    ```bash
    npm install express
    ```

3.  **Instalar Playwright (Motor de Navegación):**
    ```bash
    npm install playwright
    ```

4.  **Instalar Navegadores de Playwright:**
    ```bash
    npx playwright install
    ```
    *Nota: Necesario la primera vez para descargar los binarios de Chromium.*

## Bitácora de Clases y Explicaciones

### Clase 1: Conceptos Básicos y Estructura
**Profesor:** Establecimos la importancia de `package.json` y la estructura de carpetas.
**Alumno:** Entendí que usar `import/export` (Module) es más moderno que `require` y requiere `"type": "module"` en package.json.

### Clase 2: MVC y Rutas
**Profesor:** Separamos responsabilidades.
- **Controller:** Recibe `req` y devuelve `res`. No contiene lógica pesada.
- **Router:** Define las URLs y llama al Controller adecuado.
- **Service:** (Próximamente) Contendrá la lógica de negocio (scraping).

**Alumno:**
- Aprendí que `request` y `response` son estándares, no debo cambiarles el nombre.
- Entendí que las rutas se anidan. `app.use('/api', route)` + `router.get('/status')` da como resultado `/api/status`.

### Clase 5: Primera Conexión y Debugging
- **Error Controlado:** El servidor respondió con un error 500 explicativo gracias al `try/catch`.
- **Binarios:** Se ejecutó `npx playwright install` para descargar los navegadores (Chromium, Firefox, WebKit) que Playwright necesita para funcionar "sin cabeza" (headless).
- **Éxito:** La API logró visitar una web real y devolver su título.

### Clase 6: Manipulación del DOM y Validación de Tipos
- **Manipulación:** Inyección de código en el navegador con `page.evaluate` para eliminar elementos (`remove()`).
- **Validación Defensiva:** El controlador ahora verifica que `remove` sea un Array antes de pasarlo al servicio, evitando errores `TypeError: .forEach is not a function`.

### Clase 7: Lógica de Comparación de Textos (Laboratorio)
**Profesor:** Introducción de la lógica de "Normalización" para comparar textos sucios (HTML) contra textos esperados.
- **Concepto Clave:** "Planchar" el texto (quitar espacios dobles, trim, lowerCase) antes de comparar.
- **Metáfora:** La suma. Procesar una lista de verificaciones una por una (`.map`).
- **Archivo de estudio:** `src/examples/laboratorio_texto.js`.

### Reto Actual #1: El Juez de Texto ⚖️
**Objetivo:** Integrar la lógica del laboratorio en la API real.

**Tu Tarea:**
1.  **Estudiar:** Ejecuta `node src/examples/laboratorio_texto.js` y entiende cómo transformamos la entrada sucia y la lista esperada en un reporte limpio.
2.  **Implementar en `qaController.js`:**
    *   Habilitar la recepción de `expectedTexts` (Array) en el body.
3.  **Implementar en `scrapeService.js`:**
    *   Importar lógica de normalización.
    *   Recibir `expectedTexts`.
    *   Cambiar el retorno: DE `content string` -> A `results array` (Objeto con título y detalles de qué se encontró y qué no).

---
### Clase 8: Pasar datos al Navegador (`page.evaluate`)
**Pregunta del Alumno:** *"¿Por qué usamos `selectors` dentro de `page.evaluate` si afuera se llama `finalSelectors`?"*

**Explicación Práctica:**
El código dentro de `page.evaluate(() => { ... })` **SE EJECUTA EN EL NAVEGADOR (Chrome)**, no en tu terminal.
La variable `finalSelectors` existe en Node.js, pero "Browser Land" (el navegador) no la conoce.

**El Puente Mágico:**
```javascript
//                (1. Argumento en Node)  (2. Puente)         (3. Argumento en Navegador)
await page.evaluate( (misDatosEnBrowser)      =>       { ... }, finalSelectors );
```
1.  **Node.js** toma `finalSelectors`.
2.  Playwright lo serializa (lo convierte en texto/JSON) y lo envía a través del puente (protocolo de depuración).
3.  **Chrome** lo recibe y lo asigna al primer argumento de la función (`misDatosEnBrowser`).
4.  El nombre del argumento dentro de la función (`selectors`, `x`, `lista`) **NO IMPORTA**, lo que importa es el orden.

---
