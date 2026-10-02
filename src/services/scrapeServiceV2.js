import { chromium } from "playwright";

/**
 * Service to investigate a web page with improved text verification.
 * Based on v4.py logic for exact and partial matches.
 * @param {string} url - The web address to visit.
 * @param {array<string>} selectorsToRemove - selectors like classes, styles or js that will be removed
 * @param {array<string>} expectedTexts - expected texts to compare
 * @return {Promise<object>}- comparison results
 */

export const scrapePage = async (url, selectorsToRemove = [], expectedTexts = [])=> {
    let browser;
    try{
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        // More relaxed timeouts for heavy sites
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

        // Additional selectors for E2 inventory-type pages (applied conditionally)
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

        // Detect if the current page is E2 inventory type and merge selectors
        const hasInventoryE2 = await page.$("[data-name^='inventory-search-results']")
            || await page.$('.ws-inv-text-search')
            || await page.$('.ws-inv-filters');

        const finalSelectors = [
            ...defaultSelectors,
            ...(hasInventoryE2 ? extraInventorySelectors : []),
            ...selectorsToRemove
        ];

        await page.evaluate((selectors) => {
            // 1) Remove general and inventory UI according to selectors
            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(el=>el.remove());
            });

            // 2) Remove the inventory block ONLY if it doesn't contain editorial content
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
                    .filter(txt => txt.length >= 10); // avoid empty or very short titles
                const headingCount = headings.length;
                // Rule: remove inventory if there is not more than one significant heading
                if (headingCount <= 1) {
                    w.remove();
                }
            });
        }, finalSelectors);
        
        // Extract editorial content across .ddc-wrapper (above/below inventory), excluding UI and INVENTORY
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
            // Exclude ONLY content within the inventory listing, without excluding the combined wrapper
            const isInventoryContent = (el) => !!(el.closest('.srp-wrapper-listing')
                || el.closest('[data-name="srp-wrapper-listing-inner-inventory-results"]')
                || el.closest('[data-name="srp-wrapper-listing-inner-inventory-paging"]')
                || el.closest('[data-name^="inventory-search-results"]')
                || el.closest('[data-widget-name^="ws-inv-"]'));

            const lines = [];
            const seen = new Set();
            const pushLine = (s) => {
                const t = (s || '').replace(/\r\n/g, '\n').trim();
                if (!t) return;
                const key = t.toLowerCase();
                if (seen.has(key)) return;
                lines.push(t);
                seen.add(key);
            };
            const elems = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'))
                .filter(el => !isInventoryUI(el) && !isInventoryContent(el));
            elems.forEach(el => {
                const raw = (el.innerText || '').replace(/\r\n/g, '\n');
                const txt = raw.trim();
                if (txt) {
                    pushLine(txt);
                    if (/^H[1-6]$/i.test(el.tagName)) {
                        // Capture loose text immediately after the heading (TEXT_NODE siblings)
                        let sib = el.nextSibling;
                        let collected = '';
                        while (sib && sib.nodeType === Node.TEXT_NODE) {
                            collected += sib.textContent || '';
                            sib = sib.nextSibling;
                        }
                        if ((collected || '').trim().length > 0) {
                            pushLine(collected);
                        }
                        lines.push('');
                    }
                }
            });
            // Capture loose text nodes within editorial containers
            const contentContainers = Array.from(root.querySelectorAll(
                '.text-content-container, [data-widget-name="content-default"], [data-widget-name="content-raw"], .content-default, .mod .content, .content'
            )).filter(el => !isInventoryUI(el) && !isInventoryContent(el));
            contentContainers.forEach(container => {
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    const parent = node.parentElement;
                    if (parent && (isInventoryUI(parent) || isInventoryContent(parent))) continue;
                    const txt = (node.textContent || '').replace(/\r\n/g, '\n').trim();
                    if (txt.length >= 20) {
                        pushLine(txt);
                    }
                }
            });
            const combined = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
            if (combined.trim()) return combined;
            return (root.innerText || '').replace(/\r\n/g, '\n').trim();
        });

        // -------------------------------------------------------------
        // NORMALIZATION AND COMPARISON (v4.py approach)
        // -------------------------------------------------------------
        
        // Normalize like v4.py: trim, hyphens, but PRESERVE line breaks
        const normalizar = (texto) => {
            if (!texto) return "";
            return texto
                .trim()
                .replace(/—/g, '-')
                .replace(/–/g, '-')
                .replace(/[ \t]+/g, ' ')  // Only unify spaces and tabs, NO newlines
                .replace(/\r\n/g, '\n')   // Normalize line endings
                .toLowerCase();
        };
        
        // Normalization for comparison (no line breaks)
        const normalizarParaComparacion = (texto) => {
            if (!texto) return "";
            return texto
                .trim()
                .replace(/—/g, '-')
                .replace(/–/g, '-')
                .replace(/\s+/g, ' ')  // Convert all spaces (including newlines) to single spaces
                .toLowerCase();
        };

        // Find snippet around match in original text
        const extractMatchContext = (cleanedText, normalizedText, targetNorm, charsAround = 300) => {
            const idx = normalizedText.indexOf(targetNorm);
            if (idx === -1) return null;
            
            // Map approximate position to original text
            const startIdx = Math.max(0, idx - charsAround);
            const endIdx = Math.min(normalizedText.length, idx + targetNorm.length + charsAround);
            
            // Extract from original text without normalizing (character approximation)
            const startOrig = Math.max(0, startIdx);
            const endOrig = Math.min(cleanedText.length, endIdx + 100);
            
            // Return with line breaks preserved
            return cleanedText.substring(startOrig, endOrig).trim();
        };

        // Find the complete sentence that contains the differences
        const encontrarOracionConDiferencias = (textoEsperado, textoPagina, cleanedContent) => {
            // Normalize for comparison
            const esperadoNorm = normalizarParaComparacion(textoEsperado);
            const paginaNorm = normalizarParaComparacion(cleanedContent);
            
            // Split into words for comparison
            const palabrasEsperadas = esperadoNorm.split(' ');
            const palabrasPagina = paginaNorm.split(' ');
            
            // Find the first different word
            let primeraDiferencia = -1;
            for (let i = 0; i < palabrasEsperadas.length; i++) {
                if (!palabrasPagina.includes(palabrasEsperadas[i])) {
                    primeraDiferencia = i;
                    break;
                }
            }
            
            if (primeraDiferencia === -1) {
                // No individual word differences, look for order differences
                return null;
            }
            
            // Extract the complete sentence from expected text containing the difference
            const palabrasOriginales = textoEsperado.split(/\s+/);
            const palabraDiferente = palabrasOriginales[primeraDiferencia];
            
            // Find sentence delimiters (. ! ? or double line breaks)
            // Include single line breaks as separators for titles without periods
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
            
            // Find the equivalent sentence on the page
            // We search for the first words of the sentence to locate it
            const primerasPalabrasOracion = normalizarParaComparacion(oracionEsperada).split(' ').slice(0, 5).join(' ');
            const idx = paginaNorm.indexOf(primerasPalabrasOracion);
            
            let oracionPagina = null;
            if (idx !== -1) {
                // Find the sentence boundaries in original content
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
                oracionPagina: oracionPagina || '[The equivalent sentence was not found]'
            };
        };

        const pageTextNorm = normalizarParaComparacion(cleanedContent);

        // Analyze each expected text (v4.py approach)
        const resultados = expectedTexts.map(textoEsperado => {
            const esperadoNorm = normalizarParaComparacion(textoEsperado);
            
            if (!esperadoNorm) {
                return {
                    texto: textoEsperado,
                    estado: "⚪ EMPTY TEXT",
                    mensaje: "The expected text is empty."
                };
            }

            // CASE 1: Exact match (like v4.py)
            if (pageTextNorm.includes(esperadoNorm)) {
                const contexto = extractMatchContext(cleanedContent, pageTextNorm, esperadoNorm, 150);
                return {
                    texto: textoEsperado,
                    estado: "🟢 FULLY INTEGRATED",
                    mensaje: "The text is found exactly in the content.",
                    parrafo_texto1_esperado: textoEsperado,
                    parrafo_pagina_encontrado: contexto || textoEsperado,
                    frase_en_texto1: textoEsperado,
                    frase_en_pagina: contexto || textoEsperado
                };
            }

            // CASE 2: Partial match (50% initial like v4.py)
            const cutoffLen = esperadoNorm.length;
            if (cutoffLen > 15) {
                const halfLen = Math.floor(cutoffLen * 0.5);
                const startSnippet = esperadoNorm.substring(0, halfLen);
                
                if (pageTextNorm.includes(startSnippet)) {
                    const contexto = extractMatchContext(cleanedContent, pageTextNorm, startSnippet, 300);
                    
                    // Find specific sentences with differences
                    const diferencias = encontrarOracionConDiferencias(textoEsperado, cleanedContent, cleanedContent);
                    
                    return {
                        texto: textoEsperado,
                        estado: "🟡 INCOMPLETE TEXT",
                        mensaje: "The beginning of the paragraph was found but it is not complete or has differences.",
                        parrafo_texto1_esperado: textoEsperado,
                        parrafo_pagina_encontrado: contexto || '[Could not extract the context from the page]',
                        frase_en_texto1: diferencias?.oracionEsperada || textoEsperado,
                        frase_en_pagina: diferencias?.oracionPagina || contexto
                    };
                }
            }

            // CASE 3: Not found
            // Try to find some keywords to provide context
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
                estado: "🔴 NOT INTEGRATED",
                mensaje: mejorContexto ? 
                    "The paragraph was not found complete. Context is shown where some similar word appears." :
                    "The text does not appear in the page content.",
                parrafo_texto1_esperado: textoEsperado,
                parrafo_pagina_encontrado: mejorContexto || '[The text does not appear in the editorial block of the page]',
                frase_en_texto1: palabraEncontrada || '[N/A]',
                frase_en_pagina: mejorContexto ? mejorContexto.substring(0, 200) : '[N/A]'
            };
        });

        return { 
            title: 'Content Analysis', 
            resultados_comparacion: resultados
        };
        
    } catch(error){
        console.error('Error in scrapeServiceV2:', error);
        throw error;
    } finally{
        if(browser){
            await browser.close();
        }
    }
}

// Extract only clean content (line by line) without performing comparisons
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
            const isInventoryContent = (el) => !!(el.closest('.srp-wrapper-listing')
                || el.closest('[data-name="srp-wrapper-listing-inner-inventory-results"]')
                || el.closest('[data-name="srp-wrapper-listing-inner-inventory-paging"]')
                || el.closest('[data-name^="inventory-search-results"]')
                || el.closest('[data-widget-name^="ws-inv-"]'));

            const lines = [];
            const seen = new Set();
            const pushLine = (s) => {
                const t = (s || '').replace(/\r\n/g, '\n').trim();
                if (!t) return;
                const key = t.toLowerCase();
                if (seen.has(key)) return;
                lines.push(t);
                seen.add(key);
            };
            const elems = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li'))
                .filter(el => !isInventoryUI(el) && !isInventoryContent(el));
            elems.forEach(el => {
                const raw = (el.innerText || '').replace(/\r\n/g, '\n');
                const txt = raw.trim();
                if (txt) {
                    pushLine(txt);
                    if (/^H[1-6]$/i.test(el.tagName)) {
                        let sib = el.nextSibling;
                        let collected = '';
                        while (sib && sib.nodeType === Node.TEXT_NODE) {
                            collected += sib.textContent || '';
                            sib = sib.nextSibling;
                        }
                        if ((collected || '').trim().length > 0) {
                            pushLine(collected);
                        }
                        lines.push('');
                    }
                }
            });
            const contentContainers = Array.from(root.querySelectorAll(
                '.text-content-container, [data-widget-name="content-default"], [data-widget-name="content-raw"], .content-default, .mod .content, .content'
            )).filter(el => !isInventoryUI(el) && !isInventoryContent(el));
            contentContainers.forEach(container => {
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    const parent = node.parentElement;
                    if (parent && (isInventoryUI(parent) || isInventoryContent(parent))) continue;
                    const txt = (node.textContent || '').replace(/\r\n/g, '\n').trim();
                    if (txt.length >= 20) {
                        pushLine(txt);
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

// Line-by-line comparison (CO vs CP) with sequential alignment and sentence diffs
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
                // Choose the sentence from CP with the greatest word overlap
                let best = '';
                let bestSc = -1;
                for (const cs of cpSents) {
                    const sc = overlapScore(sNorm, normalizeLine(cs));
                    if (sc > bestSc) { bestSc = sc; best = cs; }
                }
                return { sentence_co: s.trim(), sentence_cp: (best || '').trim() };
            }
        }
        // If all sentences from CO are included, return the first one
        return { sentence_co: (coSents[0] || co).trim(), sentence_cp: (cpSents[0] || cp).trim() };
    };

    // Get clean page content
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
