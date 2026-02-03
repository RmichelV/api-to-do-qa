import { chromium } from "playwright";

//este archivo ya es la practica, donde no extraemos ya el titulo, solo el texto tal cual esta en la pagina, con saltos de lineas, espacios dobles , etc.
/**
 * Servicio para investigar una página web.
 * @param {string} url - La dirección web a visitar.
 * @param {array<string>} selectorsToRemove - selectores como clases, styles o js que se eliminaran
 * @return {Promise<string>}- el contenido de la pagina .
 */

export const scrapePage = async (url, selectorsToRemove = [], expectedTexts = [])=> {
    let browser;
    try{
        // Lanzar el navegador (headless: true significa que no se abrira como ventana, pero de ser necesario podemos ponerlo en false para que lo haga)
        browser = await chromium.launch({ headless: true });

        // Contexto nuevo (como una sesión de incógnito)
        const context = await browser.newContext();

        // Pestaña nueva
        const page = await context.newPage();
        
        // Vamos a la URL
        await page.goto(url);

        const defaultSelectors = [
            'script',
            'style',
            'noscript',
            'header',
            'footer',
            '.ddc-header',
            '.ddc-footer',
            '.page-header',
            '.page-footer',
            '.ddc-tracking',
            '.oem-includes',
            '.inventory-listing-ws-inv-data-service', 
            '.ws-inv-data.spacing-reset',
            "[data-name='srp-wrapper-page-title-content']",
            "[data-name='srp-wrapper-page-title-banner']",
            "[data-name='srp-wrapper-page-filters-sort']",
            "[data-name='srp-wrapper-listing-inner-inventory-results']",
            "[data-name='srp-wrapper-listing-inner-inventory-paging']",
            "[data-name='srp-wrapper-page-filters-sort']",  
            "[data-name='srp-wrapper-page-filters-sort-inner']",
            '#inventory-search1-app-root',
            '#inventory-filters1-app-root',
            '.ws-inv-filters',
            '#show-filters-modal-button',
            "[aria-labelledby='ws-inv-filters-modal-label']"
        ];

        const finalSelectors = [...defaultSelectors, ...selectorsToRemove];

        


        // Seccion para eliminar elemenos no deseados 
        // if( selectorsToRemove.length > 0 ){
        //     await page.evaluate((selectors) => {
        //         selectors.forEach(selector => {
        //             document.querySelectorAll(selector).forEach(el=>el.remove());
        //         });
        //     }, selectorsToRemove);
        // }
            await page.evaluate((selectors) => {
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el=>el.remove());
                });
            }, finalSelectors);
        
        
        // Obtenemos el contenido HTML limpio (solo de la clase .ddc-wrapper o fallback)
        const cleanedContent = await page.evaluate(() => {
            const contenedorPrincipal = document.querySelector('.ddc-wrapper') || document.body;
            return contenedorPrincipal.innerText;
        });

        // -------------------------------------------------------------
        // FASE 2: NORMALIZACIÓN Y COMPARACIÓN (Lógica del Docente)
        // -------------------------------------------------------------
        
        // Función interna para planchar el texto (Mejorada V2 - "Anti-Guiones Raros")
        const normalizar = (texto) => {
            if (!texto) return "";
            return texto
                .replace(/[—–]/g, '-')        // Reemplaza guiones largos/medios por guion simple
                .replace(/[“”]/g, '"')        // Reemplaza comillas curvas por rectas
                .replace(/\s+/g, ' ')         // Unifica espacios (tabs, enters -> 1 espacio)
                .trim()
                .toLowerCase();
        };

        const pageTextNorm = normalizar(cleanedContent);

        // Analizamos cada texto esperado
        const resultados = expectedTexts.map(textoEsperado => {
            const esperadoNorm = normalizar(textoEsperado);
            
            // CASO 1: INTEGRACIÓN COMPLETA (100% igual y consecutivo)
            // Esto cubre tu ejemplo: "hola mundo estoy en js" DENTRO de un párrafo gigante.
            if (pageTextNorm.includes(esperadoNorm)) {
                return {
                    texto: textoEsperado,
                    estado: "🟢 INTEGRADO COMPLETO",
                    mensaje: "El texto se encuentra al 100% y en el orden correcto dentro del contenido."
                };
            }

            // CASO 2: ANÁLISIS PROFUNDO (Si falló el exacto)
            const palabrasEsperadas = esperadoNorm.split(/\s+/); // Split por cualquier espacio
            
            // A. ¿Qué palabras faltan totalmente?
            const palabrasFaltantes = palabrasEsperadas.filter(p => !pageTextNorm.includes(p));

            // Si faltan TODAS -> NO INTEGRADO
            if (palabrasFaltantes.length === palabrasEsperadas.length) {
                return {
                    texto: textoEsperado,
                    estado: "🔴 NO INTEGRADO",
                    mensaje: "No se encontró ninguna palabra.",
                    contexto: "N/A"
                };
            }

            // B. Si faltan algunas o están todas pero mal ordenadas -> BUSCAR MEJOR CONTEXTO
            // Algoritmo: Buscar la secuencia más larga de palabras que SÍ coincida para mostrar dónde se rompió.
            let mejorSnippet = "No se pudo determinar el contexto exacto.";
            
            // Intentamos buscar al menos un bigrama (par de palabras) o la palabra mas larga 
            // para anclar la búsqueda y no mostrar el inicio de la pagina por error.
            const palabrasEncontradas = palabrasEsperadas.filter(p => !palabrasFaltantes.includes(p));
            
            if (palabrasEncontradas.length > 0) {
                // Buscamos la palabra encontrada más larga (es menos probable que sea un conector común "el", "la")
                const palabraAncla = palabrasEncontradas.reduce((a, b) => a.length > b.length ? a : b);
                const indice = pageTextNorm.indexOf(palabraAncla);
                
                if (indice !== -1) {
                    const start = Math.max(0, indice - 40);
                    const end = Math.min(pageTextNorm.length, indice + 100);
                    mejorSnippet = "..." + pageTextNorm.substring(start, end) + "...";
                }
            }

            return {
                texto: textoEsperado,
                estado: "🟡 TEXTO INCOMPLETO / DIFERENTE",
                mensaje: "El texto no coincide exactamente (puede haber palabras extra, faltantes o desorden).",
                contexto: mejorSnippet,
                detalle: {
                    palabras_faltantes: palabrasFaltantes.length > 0 ? palabrasFaltantes : ["Las palabras están, pero quizás las frases intermedias no coinciden."]
                }
            };
        });


        return { 
            title: 'Análisis de Contenido', 
            resultados_comparacion: resultados
        };
        
    }   catch(error){
        console.error('Error en scrapeServiceV2:', error);
        throw error; // Lanzamos el error para que lo maneje el controlador
    }   finally{
        // SIEMPRE cerramos el navegador, incluso si hubo error, para no dejar procesos zombies.
        if(browser){
            await browser.close();
        }
    }
}

