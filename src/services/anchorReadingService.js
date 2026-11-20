import * as cheerio from 'cheerio';
import { getRandomUserAgent } from '../utils/stealth.js';

export const activeAnchorFetchControllers = new Set();
const MAX_FORBIDDEN_ATTEMPTS = 5;
const FORBIDDEN_RETRY_DELAY_MS = 1000;

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

function delay(ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
	});
}

async function fetchAndValidateAnchors(url, { retryDelayMs = FORBIDDEN_RETRY_DELAY_MS } = {}) {
	const controller = new AbortController();
	activeAnchorFetchControllers.add(controller);
	let html;
	try {
		const headers = {
			'User-Agent': getRandomUserAgent(),
			'Accept-Language': 'en-US,en;q=0.9',
		};

		for (let attempt = 1; attempt <= MAX_FORBIDDEN_ATTEMPTS; attempt++) {
			const timer = setTimeout(() => controller.abort(), 15000);
			try {
				const response = await fetch(url, { headers, signal: controller.signal });
				if (response.status === 403) {
					try { await response.body?.cancel(); } catch {}
					if (attempt === MAX_FORBIDDEN_ATTEMPTS) {
						throw new Error(`HTTP 403 after ${MAX_FORBIDDEN_ATTEMPTS} attempts`);
					}
				} else {
					if (!response.ok) throw new Error(`HTTP ${response.status}`);
					html = await response.text();
					break;
				}
			} finally {
				clearTimeout(timer);
			}

			await delay(retryDelayMs * 2 ** (attempt - 1), controller.signal);
		}
	} finally {
		activeAnchorFetchControllers.delete(controller);
	}

	const $ = cheerio.load(html);
	if (!$('.ddc-wrapper').length) {
		return { anchors: [], misconfiguredAnchors: [], error: '.ddc-wrapper not found' };
	}

	const { wellConfigured, misconfigured } = classifyAnchorsFromHtml(html, url);
	const anchors = checkTargetsInHtml(html, wellConfigured);
	return { anchors, misconfiguredAnchors: misconfigured };
}

export const extractAndValidateAnchors = async (url, options) => fetchAndValidateAnchors(url, options);
