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
            // Priorizar el bloque de contenido dentro del inventario si existe
            const preferido = document.querySelector('[data-name="srp-wrapper-listing-inner-content"] .text-content-container.content');
            if (preferido) return preferido.innerText;

            const innerContent = document.querySelector('[data-name="srp-wrapper-listing-inner-content"]');
            if (innerContent) {
                const texto = innerContent.querySelector('.text-content-container') || innerContent.querySelector('[data-widget-name="content-default"]');
                if (texto) return texto.innerText;
                return innerContent.innerText;
            }

            // Alternativas fuera del inventario
            const anyBlock = document.querySelector('.text-content-container.content')
                || document.querySelector('.content-default .text-content-container')
                || document.querySelector('.content-default');
            if (anyBlock) return anyBlock.innerText;

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
                .toLowerCase()
                .replace(/[“”]/g, '"')
                .replace(/[’']/g, "'")
                .replace(/[—–]/g, ' ')        // dashes a espacio
                .replace(/[^a-z0-9]+/g, ' ')  // quitar puntuación y símbolos -> espacios
                .replace(/\s+/g, ' ')        // unificar espacios
                .trim();
        };

        const tokenizar = (texto) => {
            const t = normalizar(texto);
            return t.split(' ').filter(x => x.length > 0);
        };

        const subsecuenciaTokensEnOrden = (pageNorm, tokensNorm) => {
            let pos = 0;
            const encontrados = [];
            const faltantes = [];
            for (const tok of tokensNorm) {
                const idx = pageNorm.indexOf(tok, pos);
                if (idx !== -1) {
                    encontrados.push({ tok, idx });
                    pos = idx + tok.length;
                } else {
                    faltantes.push(tok);
                }
            }
            return { encontrados, faltantes };
        };

        const stopwords = new Set([
            'the','a','an','and','or','of','in','on','to','for','with','by','at','from','as','is','are','was','were','it','this','that','these','those','has','have','be'
        ]);

        const findAnchorIdx = (pageNorm, tokensNorm) => {
            // tomar primeros tokens informativos como ancla
            const candidates = tokensNorm.filter(t => !stopwords.has(t)).slice(0, 6);
            let pos = 0;
            for (const t of candidates) {
                const idx = pageNorm.indexOf(t, pos);
                if (idx === -1) return -1;
                pos = idx + t.length;
            }
            return Math.max(0, pos - (candidates.length ? candidates[candidates.length-1].length : 0));
        };

        const pageTextNorm = normalizar(cleanedContent);

        // Divide un texto esperado en segmentos (líneas) relevantes
        const segmentar = (texto) => {
            if (!texto) return [];
            return texto
                .split(/\r?\n+/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        };

        // Busca subsecuencia en orden (permitiendo contenido intermedio)
        const subsecuenciaEnOrden = (pageNorm, segmentosNorm) => {
            let pos = 0;
            const encontrados = [];
            const faltantes = [];
            for (const seg of segmentosNorm) {
                const idx = pageNorm.indexOf(seg, pos);
                if (idx !== -1) {
                    encontrados.push({ seg, idx });
                    pos = idx + seg.length;
                } else {
                    faltantes.push(seg);
                }
            }
            return { encontrados, faltantes };
        };

        // Analizamos cada texto esperado
        const resultados = expectedTexts.map(textoEsperado => {
            const esperadoNorm = normalizar(textoEsperado);

            // 1) INTEGRACIÓN COMPLETA: el texto entero como bloque contiguo
            if (pageTextNorm.includes(esperadoNorm)) {
                return {
                    texto: textoEsperado,
                    estado: "🟢 INTEGRADO COMPLETO",
                    mensaje: "El texto se encuentra como bloque contiguo dentro del contenido."
                };
            }

            // 2) INTEGRACIÓN EN ORDEN (subsecuencia): por segmentos (líneas) permitiendo contenido intermedio
            const segmentos = segmentar(textoEsperado);
            const segmentosNorm = segmentos.map(normalizar).filter(s => s.length > 0);

            if (segmentosNorm.length > 1) {
                const { encontrados, faltantes } = subsecuenciaEnOrden(pageTextNorm, segmentosNorm);
                if (faltantes.length === 0 && encontrados.length === segmentosNorm.length) {
                    const ultimo = encontrados[encontrados.length - 1];
                    const start = Math.max(0, ultimo.idx - 120);
                    const end = Math.min(pageTextNorm.length, ultimo.idx + 200);
                    const contexto = "..." + pageTextNorm.substring(start, end) + "...";
                    return {
                        texto: textoEsperado,
                        estado: "🟢 INTEGRADO EN ORDEN",
                        mensaje: "Los segmentos aparecen en el orden correcto, con contenido intermedio permitido.",
                        contexto
                    };
                }
                // Si faltan segmentos -> INCOMPLETO
                const ancla = encontrados.length ? encontrados[encontrados.length - 1] : null;
                let contexto = "N/A";
                if (ancla) {
                    const start = Math.max(0, ancla.idx - 80);
                    const end = Math.min(pageTextNorm.length, ancla.idx + 160);
                    contexto = "..." + pageTextNorm.substring(start, end) + "...";
                }
                return {
                    texto: textoEsperado,
                    estado: "🟡 TEXTO INCOMPLETO",
                    mensaje: "Faltan uno o más segmentos esperados o no se pudieron encadenar en orden.",
                    contexto,
                    detalle: {
                        segmentos_faltantes: faltantes
                    }
                };
            }

            // 3) Frase única: validar por tokens en orden dentro del bloque editorial
            const tokensEsperados = tokenizar(textoEsperado);
            if (tokensEsperados.length > 0) {
                // Buscar ancla y evaluar en ventana local
                const anchorIdx = findAnchorIdx(pageTextNorm, tokensEsperados);
                let localStart = 0;
                let localEnd = pageTextNorm.length;
                if (anchorIdx !== -1) {
                    localStart = Math.max(0, anchorIdx - 200);
                    localEnd = Math.min(pageTextNorm.length, anchorIdx + 2000);
                }
                const local = pageTextNorm.substring(localStart, localEnd);
                const { encontrados, faltantes } = subsecuenciaTokensEnOrden(local, tokensEsperados);
                const cobertura = encontrados.length / tokensEsperados.length;
                const umbral = tokensEsperados.length >= 50 ? 0.7 : 0.9;
                if (cobertura >= umbral) {
                    const ancla = encontrados[Math.max(0, Math.min(2, encontrados.length - 1))];
                    const idx = ancla ? (localStart + ancla.idx) : localStart;
                    const start = Math.max(0, idx - 120);
                    const end = Math.min(pageTextNorm.length, idx + 200);
                    const contexto = "..." + pageTextNorm.substring(start, end) + "...";
                    return {
                        texto: textoEsperado,
                        estado: "🟢 INTEGRADO EN ORDEN",
                        mensaje: "Párrafo validado por tokens en orden dentro del bloque editorial.",
                        contexto
                    };
                }
                const ancla = encontrados.length ? encontrados[encontrados.length - 1] : null;
                let contexto = "N/A";
                if (ancla) {
                    const idx = localStart + ancla.idx;
                    const start = Math.max(0, idx - 80);
                    const end = Math.min(pageTextNorm.length, idx + 160);
                    contexto = "..." + pageTextNorm.substring(start, end) + "...";
                }
                return {
                    texto: textoEsperado,
                    estado: "🟡 TEXTO INCOMPLETO",
                    mensaje: "Párrafo con cobertura insuficiente de tokens esperados en orden.",
                    contexto,
                    detalle: {
                        tokens_faltantes: faltantes
                    }
                };
            }
            return {
                texto: textoEsperado,
                estado: "🔴 NO INTEGRADO",
                mensaje: "El texto esperado está vacío o no se pudo tokenizar.",
                contexto: "N/A"
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

