// src/examples/laboratorio_texto.js

// ---------------------------------------------------------
// 🎓 CLASS: STRICT CONTENT VALIDATION (Text 1 in Text 2)
// ---------------------------------------------------------

// OBJECTIVE: Verify that what the user asks (Text 1) 
// is integrated at 100% within the page content (Text 2).

// ---------------------------------------------------------
// 1. THE INPUTS (Simulation of Reality)
// ---------------------------------------------------------

// TEXT 1: What you (the user) send us in JSON to search for.
// "I want to know if these exact phrases exist on the web".
const LISTA_INPUT_USUARIO = [
    "Bienvenido al Portal de QA",       // Caso A: Existe exacto
    "Learn advanced automation",  // Case B: Similar but different text (we want it to fail)
    "Copyright 2024"                    // Case C: Footer
];

// TEXT 2: The REAL content that Playwright extracts from the page.
// Nota: Viene con "ruido" (espacios, enters) que debemos limpiar.
const CONTENIDO_PAGINA_RAW = `
    Bienvenido al   Portal de    QA    
    
    Learn automation step by step.
    Copyright 2024. Todos los derechos reservados.
`;


// ---------------------------------------------------------
// 2. BUSINESS LOGIC (The Brain)
// ---------------------------------------------------------

// Helper function to standardize (normalize) both texts
// so the comparison is fair (ignoring invisible spaces).
function normalizar(texto) {
    if (!texto) return "";
    return texto
        .replace(/\s+/g, ' ') // Unifica espacios
        .trim()               // Quita bordes
        .toLowerCase();       // Ignore uppercase/lowercase
}

console.log("--- 🕵️‍♂️ STARTING QA ANALYSIS ---");

// STEP A: We prepare the "Board" (Text 2)
// We normalize page content ONCE.
const texto2_Pagina = normalizar(CONTENIDO_PAGINA_RAW);
console.log(`\n📄 PAGE CONTENT (Normalized):\n"${texto2_Pagina}"\n`);


// STEP B: We verify each request (Text 1) against the Board
const reporteQA = LISTA_INPUT_USUARIO.map((texto1_Input) => {
    
    // 1. Normalizamos lo que buscamos (para ser consistentes)
    const buscado = normalizar(texto1_Input);
    
    // 2. THE MILLION DOLLAR QUESTION:
    // Is Text 1 INTEGRATED completely in Text 2?
    const estaIntegrado = texto2_Pagina.includes(buscado);

    // 3. Resultado
    return {
        buscamos: texto1_Input,
        encontrado: estaIntegrado,
        // Extra message to understand what happened
        nota: estaIntegrado 
            ? "✅ SUCCESS: The text exists entirely on the page."
            : "❌ FAILED: That phrase was not found exactly.";
    };
});


// ---------------------------------------------------------
// 3. THE OUTPUT (What the user will see in Postman/Thunder)
// ---------------------------------------------------------
console.log("📊 ANALYSIS RESULT:");
console.table(reporteQA);

/* 
   CONCLUSION FOR THE STUDENT:
   En el servicio real (scrapeService.js):
   - USER_INPUT_LIST will come from `req.body.expectedTexts`
   - RAW_PAGE_CONTENT will come from `await page.evaluate(...)`
   - The logic of `map` and `normalize` is the same.
*/

