import { chromium } from 'playwright';
import { normalizeText } from '../utils/normalization.js';

/**
 * Abre la página y elimina todo excepto el contenedor .ddc-wrapper y su contenido.
 * Mantiene el navegador abierto al menos `pauseMs` milisegundos para observación.
 * @param {string} url
 * @param {{ headless?: boolean, pauseMs?: number }} options
 * @returns {Promise<{ url: string, keptWrapper: boolean }>} 
 */
// Normalización ahora importada desde utils/normalization.js

// Helper: abre la página, limpia el DOM y devuelve el texto crudo del wrapper
const extractEditorialRaw = async (url, options = {}) => {
  const headless = options.headless ?? true; // por defecto headless (no abrir navegador)
  const pauseMs = options.pauseMs ?? 0; // sin pausa por defecto

  let browser;
  try {
    console.log(`[text-reading] Launch Chromium headless=${headless}`);
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    console.log(`[text-reading] Goto start: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[text-reading] Goto complete (domcontentloaded)');

    console.log('[text-reading] Cleanup start: scope to .ddc-wrapper and remove inventory elements');
    await page.evaluate(() => {
      const wrapper = document.querySelector('.ddc-wrapper');
      if (!wrapper) return;
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
        '.srp-wrapper-facets',
        // Header / Footer / Nav dentro del wrapper
        'header', 'footer', '.global-header', '.global-footer', '.site-header', '.site-footer', '.ddc-header', '.ddc-footer', 'nav', '.primary-nav', '.site-nav',
        // Breadcrumbs / topbars / sitewide banners
        '.breadcrumbs', '.bread-crumbs', '.topbar', '.sitewide-bar',
        // Banners/overlays de cookies/promos
        '.cookie-banner', '#onetrust-banner-sdk', '[role="dialog"][aria-label*="cookie"]', '.notification-banner', '.promo-banner',
        // Widgets de chat/social/hours
        '[data-widget-name="chat"]', '.chat-widget', '.ws-hours', '.ws-social', '.ws-share'
      ];
      selectors.forEach(sel => {
        wrapper.querySelectorAll(sel).forEach(el => el.remove());
      });

      // Reaplicar la limpieza si elementos se reinsertan dinámicamente
      const unwanted = selectors.slice();
      const observer = new MutationObserver(() => {
        unwanted.forEach(sel => {
          wrapper.querySelectorAll(sel).forEach(el => el.remove());
        });
      });
      observer.observe(wrapper, { childList: true, subtree: true });
    });
    console.log('[text-reading] Cleanup done');

    // Sin pausa para evitar cuelgues y acelerar diagnóstico

    console.log('[text-reading] Extraction start: wrapper.innerText');
    const rawText = await page.evaluate(() => {
      const wrapper = document.querySelector('.ddc-wrapper');
      if (!wrapper) return '';
      return wrapper.innerText || '';
    });
    const rawLines = (rawText || '').split(/\r?\n/);
    console.log(`[text-reading] Extraction done: raw lines=${rawLines.length}`);

    return rawText;
  } finally {
    // Si se solicitó visual, esperar antes de cerrar
    if (pauseMs && pauseMs > 0) {
      try { await new Promise(resolve => setTimeout(resolve, pauseMs)); } catch {}
    }
    if (browser) { try { await browser.close(); } catch {} }
  }
};

// Endpoint preview: devuelve texto ya normalizado
export const previewTextReading = async (url, options = {}) => {
  // Watchdog: reinicia cada 5s si no hay resultado
  const retryIntervalMs = 5000;
  const maxAttempts = 12; // ~60s
  let raw = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[text-reading] Watchdog attempt ${attempt}/${maxAttempts}`);
    const extraction = extractEditorialRaw(url, options);
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), retryIntervalMs));
    const outcome = await Promise.race([extraction, timeout]);
    if (outcome === 'timeout') {
      console.log(`[text-reading] Attempt ${attempt} timed out after ${retryIntervalMs}ms — restarting`);
      continue;
    }
    raw = outcome || '';
    const hasLines = raw.split(/\r?\n/).some(l => l.trim().length > 0);
    if (hasLines) {
      console.log(`[text-reading] Watchdog success with content on attempt ${attempt}`);
      break;
    }
    console.log(`[text-reading] Attempt ${attempt} returned empty content — restarting`);
  }
  const rawLines = raw.split(/\r?\n/);
  rawLines.forEach((line, idx) => {
    console.log(`[text-reading] L${idx + 1}: ${line}`);
  });
  console.log(`[text-reading] Total líneas (raw): ${rawLines.length}`);
  const normalized = normalizeText(raw);
  const normLines = normalized.split('\n');
  console.log(`[text-reading] Total líneas (normalizado): ${normLines.length}`);
  return normalized;
};

// Comparación en servidor: devuelve JSON con CP/CO y resultados
export const compareTextReading = async (url, coText, options = {}) => {
  // Watchdog: reinicia cada 5s si no hay resultado
  const retryIntervalMs = 10000;
  const maxAttempts = 12;
  let rawCP = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[text-reading] Watchdog attempt ${attempt}/${maxAttempts} (compare)`);
    const extraction = extractEditorialRaw(url, options);
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), retryIntervalMs));
    const outcome = await Promise.race([extraction, timeout]);
    if (outcome === 'timeout') {
      console.log(`[text-reading] Attempt ${attempt} timed out after ${retryIntervalMs}ms — restarting`);
      continue;
    }
    rawCP = outcome || '';
    const hasLines = rawCP.split(/\r?\n/).some(l => l.trim().length > 0);
    if (hasLines) {
      console.log(`[text-reading] Watchdog success with content on attempt ${attempt} (compare)`);
      break;
    }
    console.log(`[text-reading] Attempt ${attempt} returned empty content — restarting`);
  }
  const cpText = normalizeText(rawCP);
  const coTextNorm = normalizeText(coText || '');

  // Logging por línea del CP (normalizado) para diagnosticar progreso
  const cpLinesLog = cpText.split('\n');
  cpLinesLog.forEach((line, idx) => {
    console.log(`[text-reading][CP] L${idx + 1}: ${line}`);
  });
  console.log(`[text-reading][CP] Total líneas: ${cpLinesLog.length}`);

  const cpLines = cpText.split('\n').filter(l => l.length > 0);
  const coLines = coTextNorm.split('\n').filter(l => l.length > 0);

  // Completeness: conteo por frecuencia
  const freq = new Map();
  for (const l of cpLines) freq.set(l, (freq.get(l) || 0) + 1);
  const details = [];
  let complete = true;
  for (const l of coLines) {
    const c = freq.get(l) || 0;
    if (c > 0) {
      freq.set(l, c - 1);
      details.push({ line: l, found: true });
    } else {
      complete = false;
      details.push({ line: l, found: false });
    }
  }

  // Order: subsecuencia (solo evaluamos si es completo)
  let ordered = false;
  let pos = 0;
  if (complete) {
    ordered = true;
    const idxDetails = [];
    for (const l of coLines) {
      let foundIdx = -1;
      for (let i = pos; i < cpLines.length; i++) {
        if (cpLines[i] === l) { foundIdx = i; break; }
      }
      if (foundIdx === -1) { ordered = false; break; }
      idxDetails.push(foundIdx);
      pos = foundIdx + 1;
    }
    // Asignar índices y tags
    let i = 0;
    for (const d of details) {
      if (d.found) {
        d.cpIndex = idxDetails[i];
        d.orderTag = 'ordered';
        i++;
      } else {
        d.cpIndex = null;
        d.orderTag = 'missing';
      }
    }
  } else {
    // Completo=false: marcar índices si existen en cualquier lugar, tag out-of-order/missing
    for (const d of details) {
      if (d.found) {
        d.cpIndex = cpLines.indexOf(d.line);
        d.orderTag = 'out-of-order';
      } else {
        d.cpIndex = null;
        d.orderTag = 'missing';
      }
    }
  }

  return {
    url,
    cp: { raw: rawCP, text: cpText, lines: cpLines },
    co: { text: coTextNorm, lines: coLines },
    result: { complete, ordered },
    details
  };
};
