import { chromium } from 'playwright';

// Ejecuta limpieza: aisla .ddc-wrapper y elimina elementos internos como en text-reading.
// No extrae ni retorna contenido.
export const runLinkReading = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0; // si visual, esperar antes de cerrar

	let browser;
	try {
		browser = await chromium.launch({ headless });
		const context = await browser.newContext();
		const page = await context.newPage();
		page.setDefaultTimeout(60000);
		page.setDefaultNavigationTimeout(60000);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

		await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return;
			// Igual que text-reading: reemplazar body con el wrapper y luego eliminar selectores
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
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

				// Mantener limpieza si se reinsertan elementos dinámicamente
				const unwanted = selectors.slice();
				const observer = new MutationObserver(() => {
					unwanted.forEach(sel => {
						wrapper.querySelectorAll(sel).forEach(el => el.remove());
					});
				});
				observer.observe(wrapper, { childList: true, subtree: true });
		});

		if (pauseMs && pauseMs > 0) {
			await new Promise(resolve => setTimeout(resolve, pauseMs));
		}
	} finally {
		if (browser) { try { await browser.close(); } catch {} }
	}
};

// Extrae texto y URL de etiquetas <a> visibles dentro de .ddc-wrapper, tras la misma limpieza
export const extractVisibleAnchors = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0;

	let browser;
	try {
		browser = await chromium.launch({ headless });
		const context = await browser.newContext();
		const page = await context.newPage();
		page.setDefaultTimeout(60000);
		page.setDefaultNavigationTimeout(60000);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

		const anchors = await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return [];
			// Igual que text-reading: aislar wrapper y limpiar elementos no editoriales
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
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
		if (browser) { try { await browser.close(); } catch {} }
	}
};

// Verifica el estado HTTP de una lista de URLs usando HEAD (fallback GET si 405/0), con límite de concurrencia
export const fetchHttpStatuses = async (urls = [], options = {}) => {
	const timeoutMs = options.timeoutMs ?? 8000;
	const concurrency = options.concurrency ?? 6;

	const results = [];
	let index = 0;

	const runOne = async (u) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const rHead = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
			clearTimeout(timer);
			return { url: u, status: rHead.status, ok: rHead.ok };
		} catch (e) {
			clearTimeout(timer);
			// Fallback GET si HEAD falla
			const controller2 = new AbortController();
			const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
			try {
				const rGet = await fetch(u, { method: 'GET', redirect: 'follow', signal: controller2.signal });
				clearTimeout(timer2);
				return { url: u, status: rGet.status, ok: rGet.ok };
			} catch (e2) {
				clearTimeout(timer2);
				return { url: u, status: 0, ok: false, error: 'timeout_or_network' };
			}
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
