import { chromium } from "playwright";

/**
 * Servicio para investigar una página web con verificación de texto mejorada.
 * Basado en la lógica de v4.py para coinc idencias exactas y parciales.
 * @param {string} url - La dirección web a visitar.
 * @param {array<string>} selectorsToRemove - selectores como clases, styles o js que se eliminaran
 * @param {array<string>} expectedTexts - textos esperados para comparar
 * @return {Promise<object>}- resultados de comparación
 */

export const scrapePage = async (url, selectorsToRemove = [], expectedTexts = [])=> {
    let browser;
    try{
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        // Timeouts más relajados por sitios pesados
        page.setDefaultTimeout(90000);
        page.setDefaultNavigationTimeout(90000);
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

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

        // Selectores adicionales para páginas tipo inventario E2 (se aplican condicionalmente)
        const extraInventorySelectors = [
            // UI de inventario (buscador, filtros, facetas, listado)
            '.ws-inv-text-search',
            '.ws-inv-filters',
            '.srp-wrapper-facets',
            // Banners/placers asociados al bloque de inventario
            "[data-name^='inventory-search-results-page-primary-banner-']",
            "[data-name^='inventory-search-results-page-filters-sort-']",
            '.content-alert-banner',
            '.ws-tps-placeholder',
            '#placeholder1-app-root',
            // Data bus/inventory servicios
            '.inventory-listing-ws-inv-data-service',
            '#inventory-data-bus2-app-root'
        ];

        // Detectar si la página actual es del tipo inventario E2 y fusionar selectores
        const hasInventoryE2 = await page.$("[data-name^='inventory-search-results']")
            || await page.$('.ws-inv-text-search')
            || await page.$('.ws-inv-filters');

        const finalSelectors = [
            ...defaultSelectors,
            ...(hasInventoryE2 ? extraInventorySelectors : []),
            ...selectorsToRemove
        ];

        await page.evaluate((selectors) => {
            // 1) Remover UI general y de inventario según selectores
            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el=>el.remove());
            });

            // 2) Remover el bloque de inventario SOLO si no contiene contenido editorial
            const isInventoryUI = (el) => !!(el.closest('.ws-inv-text-search')
                || el.closest('.ws-inv-filters')
                || el.closest('.srp-wrapper-facets')
                || el.closest('#inventory-search1-app-root')
                || el.closest('#inventory-filters1-app-root')
                || el.closest('[aria-labelledby="ws-inv-filters-modal-label"]')
                || el.closest('[data-name^="inventory-search-results-page-filters-sort-"]')
                || el.closest('[data-name^="inventory-search-results-page-primary-banner-"]')
                || el.closest('.content-alert-banner')
                || el.closest('.ws-tps-placeholder'));

            const inventoryWrappers = Array.from(document.querySelectorAll(
                '.srp-wrapper-listing, [data-name="srp-wrapper-combined"], [data-name^="inventory-search-results"], [data-name="srp-wrapper-listing-inner-inventory-results"], [data-name="srp-wrapper-listing-inner-inventory-paging"]'
            ));

            inventoryWrappers.forEach(w => {
                // Mantener inventario solo si detectamos contenido editorial con encabezados
                const headings = Array.from(w.querySelectorAll('h1,h2,h3'))
                    .filter(el => !isInventoryUI(el))
                    .map(el => (el.innerText || '').trim())
                    .filter(txt => txt.length >= 10); // evitar títulos vacíos o muy cortos
                const headingCount = headings.length;
                // Regla: eliminar inventario si no hay más de un encabezado significativo
                if (headingCount <= 1) {
                    w.remove();
                }
            });
        }, finalSelectors);
        
        // Extraer contenido editorial en todo .ddc-wrapper (arriba/abajo del inventario), excluyendo UI
        const cleanedContent = await page.evaluate(() => {
            const root = document.querySelector('.ddc-wrapper') || document.body;
            const isInventoryUI = (el) => !!(el.closest('.ws-inv-text-search')
                || el.closest('.ws-inv-filters')
                || el.closest('.srp-wrapper-facets')
                || el.closest('#inventory-search1-app-root')
                || el.closest('#inventory-filters1-app-root')
                || el.closest('[data-name^="inventory-search-results-page-filters-sort-"]')
                || el.closest('[data-name^="inventory-search-results-page-primary-banner-"]')
                || el.closest('.content-alert-banner')
                || el.closest('.ws-tps-placeholder'));

            const lines = [];
            const elems = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'))
                .filter(el => !isInventoryUI(el));
            elems.forEach(el => {
                const raw = (el.innerText || '').replace(/\r\n/g, '\n');
                const txt = raw.trim();
                if (txt) {
                    lines.push(txt);
                    if (/^H[1-6]$/i.test(el.tagName)) {
                        lines.push('');
                    }
                }
            });
            const combined = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
            if (combined.trim()) return combined;
            return (root.innerText || '').replace(/\r\n/g, '\n').trim();
        });

        // -------------------------------------------------------------
        // NORMALIZACIÓN Y COMPARACIÓN (Enfoque v4.py)
        // -------------------------------------------------------------
        
        // Normalizar como v4.py: trim, guiones, pero PRESERVAR saltos de línea
        const normalizar = (texto) => {
            if (!texto) return "";
            return texto
                .trim()
                .replace(/—/g, '-')
                .replace(/–/g, '-')
                .replace(/[ \t]+/g, ' ')  // Solo unificar espacios y tabs, NO newlines
                .replace(/\r\n/g, '\n')   // Normalizar line endings
                .toLowerCase();
        };
        
        // Normalización para comparación (sin saltos de línea)
        const normalizarParaComparacion = (texto) => {
            if (!texto) return "";
            return texto
                .trim()
                .replace(/—/g, '-')
                .replace(/–/g, '-')
                .replace(/\s+/g, ' ')  // Convertir todos los espacios (incluidos newlines) en espacios simples
                .toLowerCase();
        };

        // Buscar snippet alrededor de coincidencia en texto original
        const extractMatchContext = (cleanedText, normalizedText, targetNorm, charsAround = 300) => {
            const idx = normalizedText.indexOf(targetNorm);
            if (idx === -1) return null;
            
            // Mapear posición aproximada al texto original
            const startIdx = Math.max(0, idx - charsAround);
            const endIdx = Math.min(normalizedText.length, idx + targetNorm.length + charsAround);
            
            // Extraer del texto original sin normalizar (aproximación por caracteres)
            const startOrig = Math.max(0, startIdx);
            const endOrig = Math.min(cleanedText.length, endIdx + 100);
            
            // Devolver con saltos de línea preservados
            return cleanedText.substring(startOrig, endOrig).trim();
        };

        // Encontrar la oración completa que contiene las diferencias
        const encontrarOracionConDiferencias = (textoEsperado, textoPagina, cleanedContent) => {
            // Normalizar para comparación
            const esperadoNorm = normalizarParaComparacion(textoEsperado);
            const paginaNorm = normalizarParaComparacion(cleanedContent);
            
            // Dividir en palabras para comparar
            const palabrasEsperadas = esperadoNorm.split(' ');
            const palabrasPagina = paginaNorm.split(' ');
            
            // Encontrar la primera palabra diferente
            let primeraDiferencia = -1;
            for (let i = 0; i < palabrasEsperadas.length; i++) {
                if (!palabrasPagina.includes(palabrasEsperadas[i])) {
                    primeraDiferencia = i;
                    break;
                }
            }
            
            if (primeraDiferencia === -1) {
                // No hay diferencias de palabras individuales, buscar diferencias de orden
                return null;
            }
            
            // Extraer la oración completa del texto esperado que contiene la diferencia
            const palabrasOriginales = textoEsperado.split(/\s+/);
            const palabraDiferente = palabrasOriginales[primeraDiferencia];
            
            // Buscar delimitadores de oración (. ! ? o saltos de línea dobles)
            // Incluir saltos de línea simples como separadores para títulos sin punto
            const oraciones = textoEsperado.split(/(?<=[.!?])\s+|\n+/);
            let oracionEsperada = null;
            
            for (const oracion of oraciones) {
                if (oracion.includes(palabraDiferente)) {
                    oracionEsperada = oracion.trim();
                    break;
                }
            }
            
            if (!oracionEsperada) {
                oracionEsperada = textoEsperado; // Fallback
            }
            
            // Buscar la oración equivalente en la página
            // Buscamos las primeras palabras de la oración para ubicarla
            const primerasPalabrasOracion = normalizarParaComparacion(oracionEsperada).split(' ').slice(0, 5).join(' ');
            const idx = paginaNorm.indexOf(primerasPalabrasOracion);
            
            let oracionPagina = null;
            if (idx !== -1) {
                // Encontrar los límites de la oración en el contenido original
                const oracionesPagina = cleanedContent.split(/(?<=[.!?])\s+|\n+/);
                for (const oracion of oracionesPagina) {
                    const oracionNorm = normalizarParaComparacion(oracion);
                    if (oracionNorm.includes(primerasPalabrasOracion)) {
                        oracionPagina = oracion.trim();
                        break;
                    }
                }
            }
            
            return {
                oracionEsperada,
                oracionPagina: oracionPagina || '[No se encontró la oración equivalente]'
            };
        };

        const pageTextNorm = normalizarParaComparacion(cleanedContent);

        // Analizar cada texto esperado (enfoque v4.py)
        const resultados = expectedTexts.map(textoEsperado => {
            const esperadoNorm = normalizarParaComparacion(textoEsperado);
            
            if (!esperadoNorm) {
                return {
                    texto: textoEsperado,
                    estado: "⚪ TEXTO VACÍO",
                    mensaje: "El texto esperado está vacío."
                };
            }

            // CASO 1: Coincidencia exacta (como v4.py)
            if (pageTextNorm.includes(esperadoNorm)) {
                const contexto = extractMatchContext(cleanedContent, pageTextNorm, esperadoNorm, 150);
                return {
                    texto: textoEsperado,
                    estado: "🟢 INTEGRADO COMPLETO",
                    mensaje: "El texto se encuentra exactamente en el contenido.",
                    parrafo_texto1_esperado: textoEsperado,
                    parrafo_pagina_encontrado: contexto || textoEsperado,
                    frase_en_texto1: textoEsperado,
                    frase_en_pagina: contexto || textoEsperado
                };
            }

            // CASO 2: Coincidencia parcial (50% inicial como v4.py)
            const cutoffLen = esperadoNorm.length;
            if (cutoffLen > 15) {
                const halfLen = Math.floor(cutoffLen * 0.5);
                const startSnippet = esperadoNorm.substring(0, halfLen);
                
                if (pageTextNorm.includes(startSnippet)) {
                    const contexto = extractMatchContext(cleanedContent, pageTextNorm, startSnippet, 300);
                    
                    // Encontrar las oraciones específicas con diferencias
                    const diferencias = encontrarOracionConDiferencias(textoEsperado, cleanedContent, cleanedContent);
                    
                    return {
                        texto: textoEsperado,
                        estado: "🟡 TEXTO INCOMPLETO",
                        mensaje: "Se encontró el inicio del párrafo pero no está completo o tiene diferencias.",
                        parrafo_texto1_esperado: textoEsperado,
                        parrafo_pagina_encontrado: contexto || '[No se pudo extraer el contexto de la página]',
                        frase_en_texto1: diferencias?.oracionEsperada || textoEsperado,
                        frase_en_pagina: diferencias?.oracionPagina || contexto
                    };
                }
            }

            // CASO 3: No encontrado
            // Intentar encontrar alguna palabra clave para dar contexto
            const palabrasClave = esperadoNorm.split(' ').filter(p => p.length > 5).slice(0, 5);
            let mejorContexto = null;
            let palabraEncontrada = null;
            
            for (const palabra of palabrasClave) {
                if (pageTextNorm.includes(palabra)) {
                    mejorContexto = extractMatchContext(cleanedContent, pageTextNorm, palabra, 200);
                    palabraEncontrada = palabra;
                    break;
                }
            }
            
            return {
                texto: textoEsperado,
                estado: "🔴 NO INTEGRADO",
                mensaje: mejorContexto ? 
                    "El párrafo no se encontró completo. Se muestra contexto donde aparece alguna palabra similar." :
                    "El texto no aparece en el contenido de la página.",
                parrafo_texto1_esperado: textoEsperado,
                parrafo_pagina_encontrado: mejorContexto || '[El texto no aparece en el bloque editorial de la página]',
                frase_en_texto1: palabraEncontrada || '[N/A]',
                frase_en_pagina: mejorContexto ? mejorContexto.substring(0, 200) : '[N/A]'
            };
        });

        return { 
            title: 'Análisis de Contenido', 
            resultados_comparacion: resultados
        };
        
    } catch(error){
        console.error('Error en scrapeServiceV2:', error);
        throw error;
    } finally{
        if(browser){
            await browser.close();
        }
    }
}

// Extrae únicamente el contenido limpio (línea a línea) sin realizar comparaciones
export const extractCleanContent = async (url, selectorsToRemove = []) => {
    let browser;
    try{
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(90000);
        page.setDefaultNavigationTimeout(90000);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

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

        const extraInventorySelectors = [
            '.ws-inv-text-search',
            '.ws-inv-filters',
            '.srp-wrapper-facets',
            "[data-name^='inventory-search-results-page-primary-banner-']",
            "[data-name^='inventory-search-results-page-filters-sort-']",
            '.content-alert-banner',
            '.ws-tps-placeholder',
            '#placeholder1-app-root',
            '.inventory-listing-ws-inv-data-service',
            '#inventory-data-bus2-app-root'
        ];

        const hasInventoryE2 = await page.$("[data-name^='inventory-search-results']")
            || await page.$('.ws-inv-text-search')
            || await page.$('.ws-inv-filters');

        const finalSelectors = [
            ...defaultSelectors,
            ...(hasInventoryE2 ? extraInventorySelectors : []),
            ...selectorsToRemove
        ];

        await page.evaluate((selectors) => {
            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el=>el.remove());
            });

            const isInventoryUI = (el) => !!(el.closest('.ws-inv-text-search')
                || el.closest('.ws-inv-filters')
                || el.closest('.srp-wrapper-facets')
                || el.closest('#inventory-search1-app-root')
                || el.closest('#inventory-filters1-app-root')
                || el.closest('[aria-labelledby="ws-inv-filters-modal-label"]')
                || el.closest('[data-name^="inventory-search-results-page-filters-sort-"]')
                || el.closest('[data-name^="inventory-search-results-page-primary-banner-"]')
                || el.closest('.content-alert-banner')
                || el.closest('.ws-tps-placeholder'));

            const inventoryWrappers = Array.from(document.querySelectorAll(
                '.srp-wrapper-listing, [data-name="srp-wrapper-combined"], [data-name^="inventory-search-results"], [data-name="srp-wrapper-listing-inner-inventory-results"], [data-name="srp-wrapper-listing-inner-inventory-paging"]'
            ));

            inventoryWrappers.forEach(w => {
                const headings = Array.from(w.querySelectorAll('h1,h2,h3'))
                    .filter(el => !isInventoryUI(el))
                    .map(el => (el.innerText || '').trim())
                    .filter(txt => txt.length >= 10);
                const headingCount = headings.length;
                if (headingCount <= 1) {
                    w.remove();
                }
            });
        }, finalSelectors);

        const cleanedContent = await page.evaluate(() => {
            const root = document.querySelector('.ddc-wrapper') || document.body;
            const isInventoryUI = (el) => !!(el.closest('.ws-inv-text-search')
                || el.closest('.ws-inv-filters')
                || el.closest('.srp-wrapper-facets')
                || el.closest('#inventory-search1-app-root')
                || el.closest('#inventory-filters1-app-root')
                || el.closest('[data-name^="inventory-search-results-page-filters-sort-"]')
                || el.closest('[data-name^="inventory-search-results-page-primary-banner-"]')
                || el.closest('.content-alert-banner')
                || el.closest('.ws-tps-placeholder'));

            const lines = [];
            const elems = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'))
                .filter(el => !isInventoryUI(el));
            elems.forEach(el => {
                const raw = (el.innerText || '').replace(/\r\n/g, '\n');
                const txt = raw.trim();
                if (txt) {
                    lines.push(txt);
                    if (/^H[1-6]$/i.test(el.tagName)) {
                        lines.push('');
                    }
                }
            });
            const combined = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
            if (combined.trim()) return combined;
            return (root.innerText || '').replace(/\r\n/g, '\n').trim();
        });

        return { cleaned_text: cleanedContent };
    } finally{
        if (browser) await browser.close();
    }
}

// Comparación por líneas (CO vs CP) con alineación secuencial y diffs por oración
export const compareLines = async (url, expectedText, selectorsToRemove = []) => {
    // Helpers locales
    const normalizeLine = (s) => {
        if (!s) return '';
        return s.trim()
            .replace(/—/g, '-')
            .replace(/–/g, '-')
            .replace(/\s+/g, ' ')
            .toLowerCase();
    };
    const splitLines = (text) => (text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(t => t.trim())
        .filter(t => t.length > 0);

    const wordSet = (s) => new Set(s.split(' ').filter(Boolean));
    const overlapScore = (a, b) => {
        const A = wordSet(a); const B = wordSet(b);
        let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
        return A.size ? inter / A.size : 0;
    };
    const firstDiffSentence = (co, cp) => {
        const splitSent = (txt) => txt.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
        const coSents = splitSent(co);
        const cpSents = splitSent(cp);
        const cpAllNorm = normalizeLine(cp);
        for (const s of coSents) {
            const sNorm = normalizeLine(s);
            if (!cpAllNorm.includes(sNorm)) {
                // Elegir la oración de CP con mayor solapamiento de palabras
                let best = '';
                let bestSc = -1;
                for (const cs of cpSents) {
                    const sc = overlapScore(sNorm, normalizeLine(cs));
                    if (sc > bestSc) { bestSc = sc; best = cs; }
                }
                return { sentence_co: s.trim(), sentence_cp: (best || '').trim() };
            }
        }
        // Si todas las oraciones de CO están incluidas, devolver la primera
        return { sentence_co: (coSents[0] || co).trim(), sentence_cp: (cpSents[0] || cp).trim() };
    };

    // Obtener contenido limpio de página
    const { cleaned_text } = await extractCleanContent(url, selectorsToRemove);

    const coLinesRaw = splitLines(expectedText);
    const cpLinesRaw = splitLines(cleaned_text);
    const coNorm = coLinesRaw.map(normalizeLine);
    const cpNorm = cpLinesRaw.map(normalizeLine);

    const resultados = [];
    let j = 0; // puntero en CP
    for (let i = 0; i < coNorm.length; i++) {
        const coLine = coLinesRaw[i];
        const coN = coNorm[i];

        let matchIdx = -1;
        for (let k = j; k < cpNorm.length; k++) {
            if (cpNorm[k] === coN) { matchIdx = k; break; }
        }
        if (matchIdx !== -1) {
            resultados.push({
                idx_co: i + 1,
                idx_cp: matchIdx + 1,
                estado: '🟢 EXACTO',
                co_line: coLine,
                cp_line: cpLinesRaw[matchIdx]
            });
            j = matchIdx + 1;
            continue;
        }

        // Buscar mejor candidato posterior
        let bestIdx = -1; let bestScore = 0;
        for (let k = j; k < cpNorm.length; k++) {
            const score = overlapScore(coN, cpNorm[k]);
            if (score > bestScore) { bestScore = score; bestIdx = k; }
            if (bestScore === 1) break;
        }

        const cpCandidate = bestIdx >= 0 ? cpLinesRaw[bestIdx] : '';
        const { sentence_co, sentence_cp } = firstDiffSentence(coLine, cpCandidate || '');

        resultados.push({
            idx_co: i + 1,
            idx_cp: bestIdx >= 0 ? bestIdx + 1 : null,
            estado: bestIdx >= 0 ? '🔴 DIFERENTE' : '🔴 NO ENCONTRADA',
            co_line: coLine,
            cp_line: cpCandidate || '[No encontrada en CP] ',
            sentence_co,
            sentence_cp
        });
        // No avanzar el puntero en CP para casos diferentes: permitir que siguientes CO encuentren su match exacto
        // Solo avanzar si fuera un match exacto (ya manejado arriba)
    }

    return {
        expected_lines: coLinesRaw,
        page_lines: cpLinesRaw,
        resultados
    };
};
