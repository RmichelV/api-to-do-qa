import { chromium } from 'playwright';
import { buildBrowserHeaders, getRandomUserAgent, randomDelay } from '../utils/stealth.js';

// Registro global de browsers activos para poder cancelarlos
export const activeBrowsersLink = new Set();

const HEAVY_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

const createOptimizedPage = async (browser) => {
	const context = await browser.newContext({
		userAgent: getRandomUserAgent(),
		locale: 'en-US',
	});
	const page = await context.newPage();
	page.setDefaultTimeout(45000);
	page.setDefaultNavigationTimeout(45000);
	await page.route('**/*', (route) => {
		const type = route.request().resourceType();
		if (HEAVY_RESOURCE_TYPES.has(type)) {
			return route.abort();
		}
		return route.continue();
	});
	return page;
};

// Ejecuta limpieza: aisla .ddc-wrapper y elimina elementos internos como en text-reading.
// No extrae ni retorna contenido.
export const runLinkReading = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0; // si visual, esperar antes de cerrar

	let browser;
	try {
		browser = await chromium.launch({ headless });
		activeBrowsersLink.add(browser);
		const page = await createOptimizedPage(browser);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
		await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });

		await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return;
			// Preservar etiqueta externa h1.sr-only
			const preservedH1 = document.querySelector('h1.sr-only');
			// Igual que text-reading: reemplazar body con el wrapper y luego eliminar selectores
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
			// Si existe y está fuera del wrapper, reanexar al body
			if (preservedH1 && !wrapper.contains(preservedH1)) {
				document.body.appendChild(preservedH1);
			}
				// Igual que text-reading: eliminar inventario y elementos de UI dentro del wrapper
				const selectors = [
				"[data-name^='inventory-search-results-page-filters-sort-']",
				"[data-name^='inventory-search-results-facets-']",
				'#inventory-results1-app-root',
				'#inventory-search1-app-root',
				'#inventory-filters1-app-root',
				'#inventory-facets1-app-root',
				'#kbb-leaddriver-search',
				"[data-name^='form-centered']",
				"[data-widget-name='contact-form']",
				"[data-name^='map-hours']",
				"[data-name='map-1']",
				"[data-widget-name='map-dynamic']",
				'.facetmulti.BLANK',
				'#compareForm',
				'.ws-inv-text-search',
				'.ws-inv-filters',
				'.ws-inv-facets',
					'.srp-wrapper-facets',
					// Extras dentro del wrapper (header/footer/nav/banners/chat)
					'header', 'footer', '.global-header', '.global-footer', '.site-header', '.site-footer', '.ddc-header', '.ddc-footer', 'nav', '.primary-nav', '.site-nav',
					'.breadcrumbs', '.bread-crumbs', '.topbar', '.sitewide-bar',
					'.cookie-banner', '#onetrust-banner-sdk', '[role="dialog"][aria-label*="cookie"]', '.notification-banner', '.promo-banner',
					'[data-widget-name="chat"]', '.chat-widget', '.ws-hours', '.ws-social', '.ws-share'
			];
			selectors.forEach(sel => {
				wrapper.querySelectorAll(sel).forEach(el => el.remove());
			});

			const expandAccordionPanels = () => {
				wrapper.querySelectorAll('[aria-expanded="false"]').forEach(el => {
					el.setAttribute('aria-expanded', 'true');
					el.classList.remove('collapsed');
				});
				wrapper.querySelectorAll('.panel-collapse, .accordion-collapse, .collapse').forEach(panel => {
					panel.classList.remove('collapse');
					panel.classList.add('show', 'in');
					panel.style.display = 'block';
					panel.style.height = 'auto';
					panel.style.overflow = 'visible';
					panel.setAttribute('aria-hidden', 'false');
				});
			};

			expandAccordionPanels();

				// Mantener limpieza si se reinsertan elementos dinámicamente
				const unwanted = selectors.slice();
				const observer = new MutationObserver(() => {
					unwanted.forEach(sel => {
						wrapper.querySelectorAll(sel).forEach(el => el.remove());
					});
					expandAccordionPanels();
				});
				observer.observe(wrapper, { childList: true, subtree: true });
		});

		if (pauseMs && pauseMs > 0) {
			await new Promise(resolve => setTimeout(resolve, pauseMs));
		}
	} finally {
		if (browser) {
			activeBrowsersLink.delete(browser);
			try { await browser.close(); } catch {}
		}
	}
};

// Extrae texto y URL de etiquetas <a> visibles dentro de .ddc-wrapper, tras la misma limpieza
export const extractVisibleAnchors = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0;

	let browser;
	try {
		browser = await chromium.launch({ headless });
		activeBrowsersLink.add(browser);
		const page = await createOptimizedPage(browser);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
		await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });

		const anchors = await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return [];
			// Igual que text-reading: aislar wrapper y limpiar elementos no editoriales
			const preservedH1 = document.querySelector('h1.sr-only');
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
			if (preservedH1 && !wrapper.contains(preservedH1)) {
				document.body.appendChild(preservedH1);
			}
			const selectors = [
				"[data-name^='inventory-search-results-page-filters-sort-']",
				"[data-name^='inventory-search-results-facets-']",
				'#inventory-results1-app-root',
				'#inventory-search1-app-root',
				'#inventory-filters1-app-root',
				'#inventory-facets1-app-root',
				'#kbb-leaddriver-search',
				"[data-name^='form-centered']",
				"[data-widget-name='contact-form']",
				"[data-name^='map-hours']",
				"[data-name='map-1']",
				"[data-widget-name='map-dynamic']",
				'.facetmulti.BLANK',
				'#compareForm',
				'.ws-inv-text-search',
				'.ws-inv-filters',
				'.ws-inv-facets',
				'.srp-wrapper-facets'
			];
			selectors.forEach(sel => {
				wrapper.querySelectorAll(sel).forEach(el => el.remove());
			});
			wrapper.querySelectorAll('[aria-expanded="false"]').forEach(el => {
				el.setAttribute('aria-expanded', 'true');
				el.classList.remove('collapsed');
			});
			wrapper.querySelectorAll('.panel-collapse, .accordion-collapse, .collapse').forEach(panel => {
				panel.classList.remove('collapse');
				panel.classList.add('show', 'in');
				panel.style.display = 'block';
				panel.style.height = 'auto';
				panel.style.overflow = 'visible';
				panel.setAttribute('aria-hidden', 'false');
			});

			const isVisible = (el) => {
				const style = window.getComputedStyle(el);
				if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return false;
				// Also ensure not clipped entirely
				return true;
			};

			const results = [];
			wrapper.querySelectorAll('a').forEach(a => {
				const text = (a.innerText || '').trim();
				const href = a.href || '';
				if (text.length === 0) return;
				if (!href) return;
				if (!isVisible(a)) return;
				const rect = a.getBoundingClientRect();
				results.push({ text, url: href, x: rect.left, y: rect.top });
			});
			// Orden visual: de arriba hacia abajo, luego izquierda a derecha
			results.sort((a, b) => {
				if (a.y !== b.y) return a.y - b.y;
				return a.x - b.x;
			});
			return results;
		});

		return anchors;
	} finally {
		if (pauseMs && pauseMs > 0) {
			await new Promise(resolve => setTimeout(resolve, pauseMs));
		}
		if (browser) {
			activeBrowsersLink.delete(browser);
			try { await browser.close(); } catch {}
		}
	}
};

// Verifica el estado HTTP de una lista de URLs con headers de navegador real para evitar 403.
// Usa GET con headers stealth + delay aleatorio entre requests + concurrencia controlada.
export const fetchHttpStatuses = async (urls = [], options = {}) => {
	const timeoutMs = options.timeoutMs ?? 12000;
	const concurrency = options.concurrency ?? 5;

	const results = [];
	let index = 0;

	const runOne = async (u) => {
		await randomDelay(200, 800);
		const headers = buildBrowserHeaders(u);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(u, {
				method: 'GET',
				redirect: 'follow',
				signal: controller.signal,
				headers,
			});
			clearTimeout(timer);
			return { url: u, status: res.status, ok: res.ok };
		} catch (e) {
			clearTimeout(timer);
			return { url: u, status: 0, ok: false, error: e?.cause?.code || e?.message || 'timeout_or_network' };
		}
	};

	const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
		while (index < urls.length) {
			const current = urls[index++];
			try {
				const r = await runOne(current);
				results.push(r);
			} catch (err) {
				results.push({ url: current, status: 0, ok: false, error: err?.message || 'unknown' });
			}
		}
	});

	await Promise.all(workers);
	// Mantener el orden original
	const map = new Map(results.map(r => [r.url, r]));
	return urls.map(u => map.get(u) || { url: u, status: 0, ok: false });
};

// Extrae datos de H1: h1 visibles dentro de .ddc-wrapper (excluye .sr-only) y el texto de h1.sr-only externo si existe
export const extractH1Data = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0;
	let browser;
	try {
		browser = await chromium.launch({ headless });
		activeBrowsersLink.add(browser);
		const page = await createOptimizedPage(browser);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
		await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });

		const result = await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return { h1Texts: [], srOnlyText: null };
			const preservedH1 = document.querySelector('h1.sr-only');
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
			if (preservedH1 && !wrapper.contains(preservedH1)) {
				document.body.appendChild(preservedH1);
			}
			const selectors = [
				"[data-name^='inventory-search-results-page-filters-sort-']",
				"[data-name^='inventory-search-results-facets-']",
				'#inventory-results1-app-root',
				'#inventory-search1-app-root',
				'#inventory-filters1-app-root',
				'#inventory-facets1-app-root',
				'#kbb-leaddriver-search',
				"[data-name^='form-centered']",
				"[data-widget-name='contact-form']",
				"[data-name^='map-hours']",
				"[data-name='map-1']",
				"[data-widget-name='map-dynamic']",
				'.facetmulti.BLANK',
				'#compareForm',
				'.ws-inv-text-search',
				'.ws-inv-filters',
				'.ws-inv-facets',
				'.srp-wrapper-facets'
			];
			selectors.forEach(sel => {
				wrapper.querySelectorAll(sel).forEach(el => el.remove());
			});
			wrapper.querySelectorAll('[aria-expanded="false"]').forEach(el => {
				el.setAttribute('aria-expanded', 'true');
				el.classList.remove('collapsed');
			});
			wrapper.querySelectorAll('.panel-collapse, .accordion-collapse, .collapse').forEach(panel => {
				panel.classList.remove('collapse');
				panel.classList.add('show', 'in');
				panel.style.display = 'block';
				panel.style.height = 'auto';
				panel.style.overflow = 'visible';
				panel.setAttribute('aria-hidden', 'false');
			});

			const isVisible = (el) => {
				const style = window.getComputedStyle(el);
				if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) return false;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return false;
				return true;
			};

			const h1Nodes = Array.from(wrapper.querySelectorAll('h1'))
				.filter(h => !h.classList.contains('sr-only'))
				.filter(isVisible);

			const h1Texts = h1Nodes.map(h => (h.innerText || '').trim()).filter(t => t.length > 0);
			const srOnlyText = preservedH1 ? (preservedH1.innerText || '').trim() : null;

			return { h1Texts, srOnlyText };
		});

		return result;
	} finally {
		if (pauseMs && pauseMs > 0) {
			await new Promise(resolve => setTimeout(resolve, pauseMs));
		}
		if (browser) {
			activeBrowsersLink.delete(browser);
			try { await browser.close(); } catch {}
		}
	}
};
