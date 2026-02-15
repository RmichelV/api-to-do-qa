// src/examples/laboratorio_texto.js

// ---------------------------------------------------------
// 🎓 CLASE: VALIDACIÓN ESTRICTA DE CONTENIDO (Texto 1 en Texto 2)
// ---------------------------------------------------------

// OBJETIVO: Verificar que lo que el usuario pide (Texto 1) 
// esté integrado al 100% dentro del contenido de la página (Texto 2).

// ---------------------------------------------------------
// 1. LOS INSUMOS (Simulación de la Realidad)
// ---------------------------------------------------------

// TEXTO 1: Lo que tú (el usuario) nos envías en el JSON para buscar.
// "Quiero saber si estas frases exactas existen en la web".
const LISTA_INPUT_USUARIO = [
    "Bienvenido al Portal de QA",       // Caso A: Existe exacto
    "Aprende automatización avanzada",  // Caso B: Texto similar pero diferente (queremos que falle)
    "Copyright 2024"                    // Caso C: Pie de página
];

// TEXTO 2: El contenido REAL que Playwright extrae de la página.
// Nota: Viene con "ruido" (espacios, enters) que debemos limpiar.
const CONTENIDO_PAGINA_RAW = `
    Bienvenido al   Portal de    QA    
    
    Aprende automatización paso a paso.
    Copyright 2024. Todos los derechos reservados.
`;


// ---------------------------------------------------------
// 2. LA LÓGICA DE NEGOCIO (El Cerebro)
// ---------------------------------------------------------

// Función auxiliar para estandarizar (normalizar) ambos textos
// para que la comparación sea justa (ignorando espacios invisibles).
function normalizar(texto) {
    if (!texto) return "";
    return texto
        .replace(/\s+/g, ' ') // Unifica espacios
        .trim()               // Quita bordes
        .toLowerCase();       // Ignora mayúsculas/minúsculas
}

console.log("--- 🕵️‍♂️ INICIANDO ANÁLISIS QA ---");

// PASO A: Preparamos el "Tablero" (Texto 2)
// Normalizamos el contenido de la página UNA sola vez.
const texto2_Pagina = normalizar(CONTENIDO_PAGINA_RAW);
console.log(`\n📄 CONTENIDO PÁGINA (Normalizado):\n"${texto2_Pagina}"\n`);


// PASO B: Verificamos cada petición (Texto 1) contra el Tablero
const reporteQA = LISTA_INPUT_USUARIO.map((texto1_Input) => {
    
    // 1. Normalizamos lo que buscamos (para ser consistentes)
    const buscado = normalizar(texto1_Input);
    
    // 2. LA PREGUNTA DEL MILLÓN:
    // ¿El Texto 1 está INTEGRADO completamente en el Texto 2?
    const estaIntegrado = texto2_Pagina.includes(buscado);

    // 3. Resultado
    return {
        buscamos: texto1_Input,
        encontrado: estaIntegrado,
        // Mensaje extra para entender qué pasó
        nota: estaIntegrado 
            ? "✅ ÉXITO: El texto existe íntegramente en la página." 
            : "❌ FALLO: No se encontró exactamente esa frase."
    };
});


// ---------------------------------------------------------
// 3. LA SALIDA (Lo que verá el usuario en Postman/Thunder)
// ---------------------------------------------------------
console.log("📊 RESULTADO DEL ANÁLISIS:");
console.table(reporteQA);

/* 
   CONCLUSIÓN PARA EL ALUMNO:
   En el servicio real (scrapeService.js):
   - LISTA_INPUT_USUARIO vendrá de `req.body.expectedTexts`
   - CONTENIDO_PAGINA_RAW vendrá de `await page.evaluate(...)`
   - La lógica del `map` y `normalizar` es la misma.
*/

