import { chromium } from "playwright";

/**
 * Servicio dedicado para análisis de enlaces.
 * @param {string} url - La dirección web a visitar.
 * @param {array<string>} selectorsToRemove - selectores para limpieza de DOM.
 * @return {Promise<object>} Reporte de links.
 */
export const checkLinks = async (url, selectorsToRemove = [], contentHints = {}) => {
    let browser;
    try {
        console.log(`[LINK SERVICE] Iniciando navegador en modo VISIBLE...`);
        browser = await chromium.launch({ 
            headless: false,  // MODO VISIBLE para que veas lo que pasa
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
        });
        
        // Viewport null para usar tamaño de ventana maximizada
        const context = await browser.newContext({
            viewport: null,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();

        console.log(`[LINK SERVICE] Cargando: ${url}`);
        
        // Estrategia de carga "Humana": Cargar y esperar un poco
        // Usamos waitUntil: 'domcontentloaded' para que sea rapido y no espere a todos los trackers
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`[LINK SERVICE] Aviso: La carga tardó un poco, pero continuamos...`);
        }
        
        console.log("[LINK SERVICE] ⏳ Esperando 3 segundos (Simulación humana)...");
        await page.waitForTimeout(3000);

        // --- MANEJO DE COOKIES Y POPUPS ---
        try {
            console.log("[LINK SERVICE] Buscando banner de cookies para cerrar...");
            // Lista de selectores comunes para botones de "Aceptar" cookies en sitios automotrices
            const cookieSelectors = [
                '#onetrust-accept-btn-handler',
                'button.onetrust-close-btn-handler',
                '[aria-label="Accept Cookies"]',
                '.cookie-banner button.accept',
                'button:has-text("Accept")',
                'button:has-text("Allow")',
                'button:has-text("Aceptar")'
            ];

            for (const sel of cookieSelectors) {
                if (await page.$(sel)) {
                    await page.click(sel);
                    console.log(`[LINK SERVICE] ✅ Cookies aceptadas/cerradas usando: ${sel}`);
                    await page.waitForTimeout(1000); // Esperar que desaparezca
                    break;
                }
            }
        } catch (e) {
            console.log("[LINK SERVICE] No se pudo interactuar con cookies (o no aparecieron).");
        }

        // Selectores de limpieza base
        const defaultSelectors = [
            'script', 'style', 'noscript', 'header', 'footer',
            '.ddc-header', '.ddc-footer', '.page-header', '.page-footer',
            '.ddc-tracking', '.oem-includes', 
            // CLASES DE NAVEGACIÓN AGREGADAS:
            '.navbar', 
            '.navbar-default', 
            '.sticky-header-nav', 
            'nav', 
            '[role="navigation"]',
            // FIN CLASES NAV
            '.inventory-listing-ws-inv-data-service', 
            '.ws-inv-data.spacing-reset',
            // Remover partes del inventario pero conservar el bloque de contenido
            "[data-name='srp-wrapper-page-title-content']",
            "[data-name='srp-wrapper-page-title-banner']",
            "[data-name='srp-wrapper-page-filters-sort']",
            "[data-name='srp-wrapper-page-filters-sort-inner']",
            "[data-name='srp-wrapper-listing-inner-inventory-results']",
            "[data-name='srp-wrapper-listing-inner-inventory-paging']",
            '#inventory-search1-app-root', 
            '#inventory-filters1-app-root',
            '.ws-inv-filters',
            '.vehicle-card', 
            '.inventory-listing'
        ];
        const finalSelectors = [...defaultSelectors, ...selectorsToRemove];

        // 1. Limpieza de DOM visual (Con Timeout de Seguridad)
        console.log("[LINK SERVICE] 🧹 Eliminando elementos basura visualmente...");
        
        try {
            // Usamos race para que si el JS de la página bloquea, saltemos este paso en 4 segundos
            await Promise.race([
                page.evaluate((selectors) => {
                    selectors.forEach(selector => {
                        try {
                            // Usamos querySelectorAll y remove
                            document.querySelectorAll(selector).forEach(el => el.remove());
                        } catch(err) {
                            // Ignorar errores puntuales de DOM
                        }
                    });
                    console.log("Limpieza visual terminada.");
                }, finalSelectors),
                new Promise((_, reject) => setTimeout(() => reject(new Error("La limpieza visual tardó demasiado")), 4000))
            ]);
            console.log("[LINK SERVICE] ✨ Limpieza visual exitosa.");
        } catch (e) {
            console.log(`[LINK SERVICE] ⚠️ Alerta: ${e.message}. Saltando limpieza visual para continuar análisis...`);
        }

        // Breve pausa para que el usuario observe
        await page.waitForTimeout(1000);
        console.log("[LINK SERVICE] 📥 Extrayendo HTML para análisis seguro (solo request API)...");

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive'
        };
        const response = await context.request.get(url, { headers, timeout: 15000 });
        const html = await response.text();
        console.log(`[LINK SERVICE] 📄 HTML recuperado (${html.length} chars).`);
        
        // 2. Extracción "Estática" de links (Regex)
        let foundLinks = [];
        
        // Encontrar área de búsqueda priorizando el bloque de contenido solicitado
        // 1) Si se provee `contentHints.startText`, usarlo; 2) de lo contrario, probar con los encabezados conocidos
        let searchArea = html;
        const wrapperMatch = html.match(/class=['"][^'"]*ddc-wrapper[^'"]*['"]/i);
        if (wrapperMatch && typeof wrapperMatch.index === 'number') {
            searchArea = html.substring(wrapperMatch.index);
        }

        // Acotar por selector de data-name si existe en el HTML fuente
        const lowerHtml = html.toLowerCase();
        const contentStartMarker = 'data-name="srp-wrapper-listing-inner-content"';
        const pagingMarker = 'data-name="srp-wrapper-listing-inner-inventory-paging"';
        const contentStartIdx = lowerHtml.indexOf(contentStartMarker);
        if (contentStartIdx !== -1) {
            const afterStart = html.substring(contentStartIdx);
            const nextPagingIdxRel = afterStart.toLowerCase().indexOf(pagingMarker);
            if (nextPagingIdxRel !== -1) {
                searchArea = afterStart.substring(0, nextPagingIdxRel);
            } else {
                searchArea = afterStart;
            }
            console.log('[LINK SERVICE] 🎯 Área acotada vía selector data-name=srp-wrapper-listing-inner-content.');
        }

        const providedStart = (contentHints.startText || '').trim();
        const knownStartCandidates = [
            'Shop New Honda Models in Katy, TX',
            'Shop New Honda Models in Katy, Texas'
        ];
        const knownEndCandidates = [
            'Test-Drive New Honda Models in Katy, TX',
            'Test Drive New Honda Models in Katy, TX'
        ];

        const toLower = (s) => (s || '').toLowerCase();
        const areaLower = toLower(searchArea);
        const locateIndex = (haystack, needles) => {
            for (const n of needles) {
                const idx = haystack.indexOf(toLower(n));
                if (idx !== -1) return idx;
            }
            return -1;
        };

        // Determinar inicio
        let startIdx = -1;
        if (providedStart) {
            startIdx = areaLower.indexOf(toLower(providedStart));
        } else {
            startIdx = locateIndex(areaLower, knownStartCandidates);
        }

        // Si se encuentra el inicio, acotar `searchArea` desde ahí
        if (startIdx !== -1) {
            searchArea = searchArea.substring(startIdx);
            // Opcional: si hay fin conocido, recortar hasta ahí para evitar footer
            const endIdxLower = locateIndex(areaLower.substring(startIdx), knownEndCandidates);
            if (endIdxLower !== -1) {
                // Extender un poco más allá del encabezado de fin para incluir el párrafo siguiente
                const extendChars = 3000; // margen razonable
                const sliceEnd = Math.min(startIdx + endIdxLower + extendChars, searchArea.length);
                searchArea = searchArea.substring(0, sliceEnd);
            }
            console.log('[LINK SERVICE] 🎯 Área acotada al bloque de contenido solicitado.');
        } else {
            console.log('[LINK SERVICE] ℹ️ No se ubicó encabezado de contenido, usando área por defecto (.ddc-wrapper/body).');
        }
        
        // Regex para extraer href y texto de tags <a> del HTML crudo
        const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;
        let match;
        
        const baseOrigin = new URL(url).origin;

        while ((match = linkRegex.exec(searchArea)) !== null) {
            const hrefRaw = match[2].trim();
            const contentRaw = match[3];  // HTML dentro del <a>

            if(!hrefRaw) continue;
            if(hrefRaw.startsWith('tel:') || hrefRaw.startsWith('mailto:') || hrefRaw.startsWith('javascript:') || hrefRaw === '#' || hrefRaw.startsWith('#')) continue;

            // Limpieza básica de texto
            let textoLimpio = contentRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if(!textoLimpio) textoLimpio = "[Sin texto / Imagen]";
            if(textoLimpio.length > 60) textoLimpio = textoLimpio.substring(0, 60) + "...";

            // Filtros de inventario extra en el texto/href por seguridad
            const lowHref = hrefRaw.toLowerCase();
            const lowText = textoLimpio.toLowerCase();
            
            if (lowHref.includes('inventory') || 
                lowHref.includes('vehicle-card') || 
                lowText.includes('view details') || 
                lowText.includes('check availability')) {
                continue;
            }

            // Normalización
            let absoluteUrl = hrefRaw;
            try {
                if (hrefRaw.startsWith('/')) {
                    absoluteUrl = baseOrigin + hrefRaw;
                } else if (!hrefRaw.startsWith('http')) {
                    absoluteUrl = new URL(hrefRaw, url).href;
                }
            } catch (e) { continue; }

            foundLinks.push({
                href: absoluteUrl,
                texto: textoLimpio
            });
        }

        // De-duplicar
        const uniqueLinks = [];
        const seen = new Set();
        for(const item of foundLinks){
            if(!seen.has(item.href)){
                seen.add(item.href);
                uniqueLinks.push(item);
            }
        }

        console.log(`[LINK SERVICE] Total links únicos a verificar: ${uniqueLinks.length}`);

        // Si no hay links, devolvemos diagnóstico temprano
        if (uniqueLinks.length === 0) {
            return {
                total_encontrados: 0,
                resultados: [],
                diagnostics: {
                    reason: 'No se encontraron etiquetas <a> en el área ddc-wrapper del HTML fuente',
                    html_length: html.length,
                    wrapper_detected: Boolean(wrapperMatch && wrapperMatch.index),
                    url
                }
            };
        }

        // 3. Verificación de Status (Por lotes pequeños para no parecer bot agresivo)
        const results = [];
        const batchSize = 5; // Lote pequeño
        const maxLinks = 40; // Validar máximo 40 para no tardar mucho en demo
        const linksToVerify = uniqueLinks.slice(0, maxLinks);
        const verifyStart = Date.now();
        const verifyTimeBudgetMs = 15000; // 15s presupuesto total de verificación

        for (let i = 0; i < linksToVerify.length; i += batchSize) {
            const batch = linksToVerify.slice(i, i + batchSize);
            console.log(`[LINK SERVICE] Verificando lote ${i + 1} a ${Math.min(i + batchSize, linksToVerify.length)}...`);
            
            const batchResults = await Promise.all(batch.map(async (link) => {
                const timeouts = [5000, 9000, 15000];
                let lastError = null;
                for (const to of timeouts) {
                    try {
                        const response = await context.request.get(link.href, {
                            timeout: to,
                            ignoreHTTPSErrors: true,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': '*/*',
                                'Accept-Language': 'en-US,en;q=0.5',
                                'Referer': url,
                                'Connection': 'keep-alive'
                            }
                        });
                        return { ...link, status: response.status() };
                    } catch (error) {
                        lastError = error;
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
                return { ...link, status: 'ERR', error: lastError ? lastError.message : 'Unknown error' };
            }));
            
            results.push(...batchResults);
            
            // Pausa entre lotes (humana)
            if (i + batchSize < linksToVerify.length) {
                await new Promise(r => setTimeout(r, 1000));
            }

            // Salida temprana si superamos el presupuesto de tiempo
            if (Date.now() - verifyStart > verifyTimeBudgetMs) {
                console.log('[LINK SERVICE] ⏱️ Presupuesto de tiempo de verificación agotado, devolviendo resultados parciales.');
                break;
            }
        }

        return {
            total_encontrados: uniqueLinks.length,
            resultados: results,
            diagnostics: {
                verified_count: results.length,
                time_ms: Date.now() - verifyStart,
                batches: Math.ceil(Math.min(linksToVerify.length, maxLinks) / batchSize)
            }
        };

    } catch (error) {
        console.error("LinkService Error:", error);
        throw error;
    } finally {
        if(browser) await browser.close();
    }
};
