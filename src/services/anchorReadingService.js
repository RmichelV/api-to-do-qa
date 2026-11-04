import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { getRandomUserAgent } from '../utils/stealth.js';

// Global registry of active browsers so they can be cancelled
export const activeBrowsersAnchor = new Set();

const HEAVY_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// ─────────────────────────────────────────────
// Helpers compartidos
// ─────────────────────────────────────────────

function classifyAnchorsFromHtml(html, pageUrl) {
	const $ = cheerio.load(html);
	const well = [];
	const misc = [];

	$('.ddc-wrapper a').each((_, el) => {
		const href = $(el).attr('href') || '';
		const text = $(el).text().trim();
		if (!text || !href.includes('#')) return;

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
	// Use an attribute selector instead of CSS.escape (unavailable in Node.js)
	const $ = cheerio.load(html);
	return anchors.map(a => ({
		text: a.text,
		href: a.href,
		targetExists: $(`[id="${a.targetId}"]`).length > 0,
	}));
}

function consolidateAnchorResults(results) {
	const consolidate = (key) => {
		const byIdentity = new Map();

		for (const result of results) {
			const occurrences = new Map();
			for (const anchor of result[key] || []) {
				const baseIdentity = JSON.stringify([anchor.href, anchor.text]);
				const occurrence = occurrences.get(baseIdentity) || 0;
				occurrences.set(baseIdentity, occurrence + 1);
				const identity = JSON.stringify([baseIdentity, occurrence]);

				let record = byIdentity.get(identity);
				if (!record) {
					record = { anchor, runs: 0, targetExistsVotes: 0 };
					byIdentity.set(identity, record);
				}
				record.runs++;
				if (anchor.targetExists) record.targetExistsVotes++;
			}
		}

		return [...byIdentity.values()]
			.filter(record => record.runs >= 2)
			.map(({ anchor, targetExistsVotes, runs }) => key === 'anchors'
				? { ...anchor, targetExists: targetExistsVotes > runs / 2 }
				: anchor);
	};

	const response = {
		anchors: consolidate('anchors'),
		misconfiguredAnchors: consolidate('misconfiguredAnchors'),
	};
	if (results.every(result => result.error)) {
		response.error = results.at(-1).error;
	}
	return response;
}

// ─────────────────────────────────────────────
// Strategy 1: fetch + cheerio (no browser)
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
	if (!$('.ddc-wrapper').length) return null; // no wrapper → fallback

	const { wellConfigured, misconfigured } = classifyAnchorsFromHtml(html, url);
	if (!wellConfigured.length && !misconfigured.length) return null; // no anchors → fallback

	const anchors = checkTargetsInHtml(html, wellConfigured);
	return { anchors, misconfiguredAnchors: misconfigured };
}

// ─────────────────────────────────────────────
// Strategy 2: Playwright — DOM only, no clicks or scrolls
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
			return { anchors: [], misconfiguredAnchors: [], error: '.ddc-wrapper not found' };
		}

		// Extract links from .ddc-wrapper without isolating the DOM
		const { wellConfigured, misconfigured } = await page.evaluate((pageUrl) => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return { wellConfigured: [], misconfigured: [] };
			const well = [];
			const misc = [];

			wrapper.querySelectorAll('a').forEach(a => {
				const href = a.getAttribute('href') || '';
				const text = (a.innerText || '').trim();
				if (!text || !href.includes('#')) return;

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

		// Check all targets in a single evaluate call (without an await loop)
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
// Entry point
// ─────────────────────────────────────────────

export const extractAndValidateAnchors = async (url, options = {}) => {
	const results = [];
	let lastError;
	let completedRuns = 0;

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			// Strategy 1: fast, no browser
			let result = await tryFetchStrategy(url);
			if (!result) {
				// Strategy 2: fallback with Playwright
				result = await tryPlaywrightStrategy(url, options);
			}
			results.push(result);
			completedRuns++;
		} catch (error) {
			lastError = error;
			results.push({ anchors: [], misconfiguredAnchors: [] });
		}
	}

	if (completedRuns === 0) throw lastError;
	return consolidateAnchorResults(results);
};
