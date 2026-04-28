import { chromium } from 'playwright';
import { normalizeText } from '../utils/normalization.js';

// Registro global de browsers activos para poder cancelarlos
export const activeBrowsersMobile = new Set();

const HEAVY_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

// Emulación de iPhone 14 Pro Max
const MOBILE_CONTEXT_OPTIONS = {
  viewport: { width: 430, height: 932 },
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
};

// Helper: abre la página en modo mobile, limpia el DOM y devuelve el texto crudo del wrapper
const extractEditorialRawMobile = async (url, options = {}) => {
  const headless = options.headless ?? true;
  const pauseMs = options.pauseMs ?? 0;

  let browser;
  try {
    console.log(`[text-reading-mobile] Launch Chromium headless=${headless}`);
    browser = await chromium.launch({ headless });
    activeBrowsersMobile.add(browser);
    const context = await browser.newContext(MOBILE_CONTEXT_OPTIONS);
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

    console.log(`[text-reading-mobile] Goto start: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(`[text-reading-mobile] Goto complete. Final URL: ${page.url()}`);

    let wrapperFound = false;
    try {
      await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });
      wrapperFound = true;
      console.log('[text-reading-mobile] .ddc-wrapper found');
    } catch {
      console.log('[text-reading-mobile] .ddc-wrapper NOT found after 10s');
    }

    const rootSelectorUsed = '.ddc-wrapper';

    // Delay para contenido dinámico
    await page.waitForTimeout(600);

    // Diagnóstico
    const diagInfo = await page.evaluate((rootSel) => {
      const wrapper = document.querySelector(rootSel);
      return {
        wrapperExists: !!wrapper,
        wrapperChildCount: wrapper ? wrapper.children.length : 0,
        wrapperTextLen: wrapper ? (wrapper.innerText || '').length : 0,
        bodyHtmlLen: document.body.innerHTML.length,
        title: document.title
      };
    }, rootSelectorUsed);
    console.log(`[text-reading-mobile] DIAG: ${JSON.stringify(diagInfo)}`);

    // Si no hay wrapper en mobile, limpiamos/expandimos sobre body para no perder el bloque editorial.
    if (!wrapperFound || diagInfo.wrapperTextLen === 0) {
      console.log('[text-reading-mobile] Wrapper not available; using body cleanup + accordion expansion');
      const bodyText = await page.evaluate(() => {
        const root = document.body;
        if (!root) return '';

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
          'header', 'footer', '.global-header', '.global-footer', '.site-header', '.site-footer', '.ddc-header', '.ddc-footer', 'nav', '.primary-nav', '.site-nav',
          '.breadcrumbs', '.bread-crumbs', '.topbar', '.sitewide-bar',
          '.cookie-banner', '#onetrust-banner-sdk', '[role="dialog"][aria-label*="cookie"]', '.notification-banner', '.promo-banner',
          '[data-widget-name="chat"]', '.chat-widget', '.ws-hours', '.ws-social', '.ws-share'
        ];

        selectors.forEach(sel => {
          root.querySelectorAll(sel).forEach(el => el.remove());
        });

        const forceOpenPanel = (toggleEl) => {
          if (!(toggleEl instanceof HTMLElement)) return;
          toggleEl.setAttribute('aria-expanded', 'true');
          toggleEl.classList.remove('collapsed');

          const href = toggleEl.getAttribute('href') || '';
          const ariaControls = toggleEl.getAttribute('aria-controls') || '';
          const targetSelector = ariaControls
            ? `#${ariaControls}`
            : (href.startsWith('#') && href.length > 1)
              ? href
              : '';

            const openPanel = (target) => {
              if (!(target instanceof HTMLElement)) return;
              target.classList.remove('collapse');
              target.classList.add('show', 'in');
              target.style.display = 'block';
              target.style.height = 'auto';
              target.style.maxHeight = 'none';
              target.style.overflow = 'visible';
              target.style.visibility = 'visible';
              target.style.opacity = '1';
              target.setAttribute('aria-hidden', 'false');
            };

            let target = null;
            if (targetSelector) {
              try {
                target = root.querySelector(targetSelector) || document.querySelector(targetSelector);
              } catch {
                target = null;
              }
            }

            if (!target) {
              const panelContainer = toggleEl.closest('.panel, .accordion-item, .panel-group, [data-testid="accordion-content-item"]');
              target = panelContainer?.querySelector?.('.panel-collapse, .accordion-collapse, .collapse') || null;
            }

            openPanel(target);
        };

        root.querySelectorAll('[aria-expanded="false"]').forEach(el => {
          el.setAttribute('aria-expanded', 'true');
          el.classList.remove('collapsed');
        });
        root.querySelectorAll('.panel-collapse, .accordion-collapse, .collapse').forEach(panel => {
          panel.classList.remove('collapse');
          panel.classList.add('show', 'in');
          panel.style.display = 'block';
          panel.style.height = 'auto';
          panel.style.maxHeight = 'none';
          panel.style.overflow = 'visible';
          panel.style.visibility = 'visible';
          panel.style.opacity = '1';
          panel.setAttribute('aria-hidden', 'false');
        });

        const toggles = Array.from(
          root.querySelectorAll('a[role="button"], button[aria-expanded], [data-toggle="collapse"], [data-bs-toggle="collapse"]')
        );
        toggles.forEach(toggle => {
          forceOpenPanel(toggle);
          if (toggle instanceof HTMLElement) {
            try { toggle.click(); } catch {}
            forceOpenPanel(toggle);
          }
        });

        return root.innerText || '';
      });

      await page.waitForTimeout(450);

      if (bodyText.trim().length > 0) {
        console.log(`[text-reading-mobile] Body fallback: ${bodyText.length} chars`);
        return bodyText;
      }
      return '';
    }

    // Abrir acordeones en el DOM original (antes de aislar), por si el contenido se renderiza bajo evento.
    await page.evaluate((rootSel) => {
      const root = document.querySelector(rootSel);
      if (!root) return;

      const forceOpenPanel = (toggleEl) => {
        if (!(toggleEl instanceof HTMLElement)) return;
        toggleEl.setAttribute('aria-expanded', 'true');
        toggleEl.classList.remove('collapsed');

        const href = toggleEl.getAttribute('href') || '';
        const ariaControls = toggleEl.getAttribute('aria-controls') || '';
        const targetSelector = ariaControls
          ? `#${ariaControls}`
          : href.startsWith('#')
            ? href
            : '';

        if (!targetSelector) return;
        const target = root.querySelector(targetSelector) || document.querySelector(targetSelector);
        if (!(target instanceof HTMLElement)) return;
        target.classList.remove('collapse');
        target.classList.add('show', 'in');
        target.style.display = 'block';
        target.style.height = 'auto';
        target.style.maxHeight = 'none';
        target.style.overflow = 'visible';
        target.style.visibility = 'visible';
        target.style.opacity = '1';
        target.setAttribute('aria-hidden', 'false');
      };

      const toggles = Array.from(
        root.querySelectorAll('a[role="button"], button[aria-expanded], [data-toggle="collapse"], [data-bs-toggle="collapse"]')
      );

      toggles.forEach(toggle => {
        forceOpenPanel(toggle);
        if (toggle instanceof HTMLElement) {
          try { toggle.click(); } catch {}
          forceOpenPanel(toggle);
        }
      });
    }, rootSelectorUsed);

    await page.waitForTimeout(500);

    console.log('[text-reading-mobile] Cleanup start');
    await page.evaluate((rootSel) => {
      const wrapper = document.querySelector(rootSel);
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
        'header', 'footer', '.global-header', '.global-footer', '.site-header', '.site-footer', '.ddc-header', '.ddc-footer', 'nav', '.primary-nav', '.site-nav',
        '.breadcrumbs', '.bread-crumbs', '.topbar', '.sitewide-bar',
        '.cookie-banner', '#onetrust-banner-sdk', '[role="dialog"][aria-label*="cookie"]', '.notification-banner', '.promo-banner',
        '[data-widget-name="chat"]', '.chat-widget', '.ws-hours', '.ws-social', '.ws-share'
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
        panel.style.maxHeight = 'none';
        panel.style.overflow = 'visible';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
        panel.setAttribute('aria-hidden', 'false');
      });

      // Algunos acordeones renderizan el contenido solo al hacer toggle.
      const toggles = Array.from(
        wrapper.querySelectorAll('a[role="button"], button[aria-expanded], [data-toggle="collapse"], [data-bs-toggle="collapse"]')
      );

      const forceOpenPanel = (toggleEl) => {
        if (!(toggleEl instanceof HTMLElement)) return;
        toggleEl.setAttribute('aria-expanded', 'true');
        toggleEl.classList.remove('collapsed');

        const href = toggleEl.getAttribute('href') || '';
        const ariaControls = toggleEl.getAttribute('aria-controls') || '';
        const targetSelector = ariaControls
          ? `#${ariaControls}`
          : (href.startsWith('#') && href.length > 1)
            ? href
            : '';

        const openPanel = (target) => {
          if (!(target instanceof HTMLElement)) return;
          target.classList.remove('collapse');
          target.classList.add('show', 'in');
          target.style.display = 'block';
          target.style.height = 'auto';
          target.style.maxHeight = 'none';
          target.style.overflow = 'visible';
          target.style.visibility = 'visible';
          target.style.opacity = '1';
          target.setAttribute('aria-hidden', 'false');
        };

        let target = null;
        if (targetSelector) {
          try {
            target = wrapper.querySelector(targetSelector) || document.querySelector(targetSelector);
          } catch {
            target = null;
          }
        }

        if (!target) {
          const panelContainer = toggleEl.closest('.panel, .accordion-item, .panel-group, [data-testid="accordion-content-item"]');
          target = panelContainer?.querySelector?.('.panel-collapse, .accordion-collapse, .collapse') || null;
        }

        openPanel(target);
      };

      toggles.forEach(toggle => {
        forceOpenPanel(toggle);
        if (toggle instanceof HTMLElement) {
          try { toggle.click(); } catch {}
          forceOpenPanel(toggle);
        }
      });
    }, rootSelectorUsed);

    // Breve espera para que acordeones que renderizan bajo evento click inserten contenido.
    await page.waitForTimeout(500);
    console.log('[text-reading-mobile] Cleanup done');

    const rawText = await page.evaluate((rootSel) => {
      const wrapper = document.querySelector(rootSel) || document.body;
      if (!wrapper) return '';
      return wrapper.innerText || '';
    }, rootSelectorUsed);
    const rawLines = (rawText || '').split(/\r?\n/);
    console.log(`[text-reading-mobile] Extraction done: raw lines=${rawLines.length}`);

    return rawText;
  } finally {
    if (pauseMs && pauseMs > 0) {
      try { await new Promise(resolve => setTimeout(resolve, pauseMs)); } catch {}
    }
    if (browser) {
      activeBrowsersMobile.delete(browser);
      try { await browser.close(); } catch {}
    }
  }
};

// Endpoint preview mobile: devuelve texto ya normalizado
export const previewTextReadingMobile = async (url, options = {}) => {
  const retryIntervalMs = 45000;
  const maxAttempts = 3;
  let raw = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[text-reading-mobile] Watchdog attempt ${attempt}/${maxAttempts}`);
    const extraction = extractEditorialRawMobile(url, options);
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), retryIntervalMs));
    const outcome = await Promise.race([extraction, timeout]);
    if (outcome === 'timeout') {
      console.log(`[text-reading-mobile] Attempt ${attempt} timed out — restarting`);
      continue;
    }
    raw = outcome || '';
    const hasLines = raw.split(/\r?\n/).some(l => l.trim().length > 0);
    if (hasLines) {
      console.log(`[text-reading-mobile] Watchdog success on attempt ${attempt}`);
      break;
    }
    console.log(`[text-reading-mobile] Attempt ${attempt} returned empty — restarting`);
  }
  const rawLines = raw.split(/\r?\n/);
  rawLines.forEach((line, idx) => {
    console.log(`[text-reading-mobile] L${idx + 1}: ${line}`);
  });
  console.log(`[text-reading-mobile] Total líneas (raw): ${rawLines.length}`);
  const normalized = normalizeText(raw);
  const normLines = normalized.split('\n');
  console.log(`[text-reading-mobile] Total líneas (normalizado): ${normLines.length}`);
  return normalized;
};

// Comparación mobile en servidor: devuelve JSON con CP/CO y resultados
export const compareTextReadingMobile = async (url, coText, options = {}) => {
  const retryIntervalMs = 45000;
  const maxAttempts = 3;
  let rawCP = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[text-reading-mobile] Watchdog attempt ${attempt}/${maxAttempts} (compare)`);
    const extraction = extractEditorialRawMobile(url, options);
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), retryIntervalMs));
    const outcome = await Promise.race([extraction, timeout]);
    if (outcome === 'timeout') {
      console.log(`[text-reading-mobile] Attempt ${attempt} timed out — restarting`);
      continue;
    }
    rawCP = outcome || '';
    const hasLines = rawCP.split(/\r?\n/).some(l => l.trim().length > 0);
    if (hasLines) {
      console.log(`[text-reading-mobile] Watchdog success on attempt ${attempt} (compare)`);
      break;
    }
    console.log(`[text-reading-mobile] Attempt ${attempt} returned empty — restarting`);
  }
  const cpText = normalizeText(rawCP);
  const coTextNorm = normalizeText(coText || '');

  const cpLinesLog = cpText.split('\n');
  cpLinesLog.forEach((line, idx) => {
    console.log(`[text-reading-mobile][CP] L${idx + 1}: ${line}`);
  });
  console.log(`[text-reading-mobile][CP] Total líneas: ${cpLinesLog.length}`);

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
