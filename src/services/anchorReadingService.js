import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { getRandomUserAgent } from '../utils/stealth.js';

// Registro global de browsers activos para poder cancelarlos
export const activeBrowsersAnchor = new Set();

const HEAVY_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// ─────────────────────────────────────────────
// Helpers compartidos
// ─────────────────────────────────────────────

function classifyAnchorsFromHtml(html, pageUrl) {
	const $ = cheerio.load(html);
	const well = [];
	const misc = [];
	const seen = new Set();

	$('.ddc-wrapper a').each((_, el) => {
		const href = $(el).attr('href') || '';
		const text = $(el).text().trim();
		if (!text || !href.includes('#') || seen.has(href)) return;
		seen.add(href);

		const hashIdx = href.indexOf('#');
		const base = href.substring(0, hashIdx);
		const id = href.substring(hashIdx + 1);
		if (!id) return;

		if (base === '' || base === pageUrl) {
			well.push({ text, href, targetId: id });
		} else {
			misc.push({ text, href });
		}
	});

	return { wellConfigured: well, misconfigured: misc };
}

function checkTargetsInHtml(html, anchors) {
	// Usa atributo selector en lugar de CSS.escape (no disponible en Node.js)
	const $ = cheerio.load(html);
	return anchors.map(a => ({
		text: a.text,
		href: a.href,
		targetExists: $(`[id="${a.targetId}"]`).length > 0,
	}));
}

// ─────────────────────────────────────────────
// Estrategia 1: fetch + cheerio (sin browser)
// ─────────────────────────────────────────────

async function tryFetchStrategy(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15000);

	let html;
	try {
		const resp = await fetch(url, {
			headers: {
				'User-Agent': getRandomUserAgent(),
				'Accept-Language': 'en-US,en;q=0.9',
			},
			signal: controller.signal,
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		html = await resp.text();
	} finally {
		clearTimeout(timer);
	}

	const $ = cheerio.load(html);
	if (!$('.ddc-wrapper').length) return null; // sin wrapper → fallback

	const { wellConfigured, misconfigured } = classifyAnchorsFromHtml(html, url);
	if (!wellConfigured.length && !misconfigured.length) return null; // sin anchors → fallback

	const anchors = checkTargetsInHtml(html, wellConfigured);
	return { anchors, misconfiguredAnchors: misconfigured };
}

// ─────────────────────────────────────────────
// Estrategia 2: Playwright — solo DOM, sin click ni scroll
// ─────────────────────────────────────────────

async function tryPlaywrightStrategy(url, options = {}) {
	const headless = options.headless ?? true;
	let browser;
	try {
		browser = await chromium.launch({ headless });
		activeBrowsersAnchor.add(browser);

		const context = await browser.newContext({
			userAgent: getRandomUserAgent(),
			locale: 'en-US',
		});
		const page = await context.newPage();
		page.setDefaultTimeout(30000);
		page.setDefaultNavigationTimeout(30000);

		await page.route('**/*', (route) => {
			const type = route.request().resourceType();
			if (HEAVY_RESOURCE_TYPES.has(type)) return route.abort();
			return route.continue();
		});

		await page.goto(url, { waitUntil: 'load', timeout: 30000 });

		try {
			await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });
		} catch {
			return { anchors: [], misconfiguredAnchors: [], error: 'No se encontró .ddc-wrapper' };
		}

		// Extraer links desde .ddc-wrapper (sin aislar el DOM)
		const { wellConfigured, misconfigured } = await page.evaluate((pageUrl) => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return { wellConfigured: [], misconfigured: [] };
			const seen = new Set();
			const well = [];
			const misc = [];

			wrapper.querySelectorAll('a').forEach(a => {
				const href = a.getAttribute('href') || '';
				const text = (a.innerText || '').trim();
				if (!text || !href.includes('#') || seen.has(href)) return;
				seen.add(href);

				const hashIdx = href.indexOf('#');
				const base = href.substring(0, hashIdx);
				const id = href.substring(hashIdx + 1);
				if (!id) return;

				if (base === '' || base === pageUrl) {
					well.push({ text, href, targetId: id });
				} else {
					misc.push({ text, href });
				}
			});
			return { wellConfigured: well, misconfigured: misc };
		}, url);

		// Verificar todos los destinos en un solo evaluate (sin loop de awaits)
		const anchors = await page.evaluate((items) => {
			return items.map(a => ({
				text: a.text,
				href: a.href,
				targetExists: !!(document.getElementById(a.targetId)
					|| document.querySelector(`[id="${a.targetId}"]`)),
			}));
		}, wellConfigured);

		return { anchors, misconfiguredAnchors: misconfigured };
	} finally {
		if (browser) {
			activeBrowsersAnchor.delete(browser);
			try { await browser.close(); } catch {}
		}
	}
}

// ─────────────────────────────────────────────
// Punto de entrada
// ─────────────────────────────────────────────

export const extractAndValidateAnchors = async (url, options = {}) => {
	// Estrategia 1: rápida, sin browser
	try {
		const result = await tryFetchStrategy(url);
		if (result) return result;
	} catch {
		// fetch falló → continuar al fallback
	}

	// Estrategia 2: fallback con Playwright (sin click, sin scroll, sin aislación)
	return tryPlaywrightStrategy(url, options);
};
