import { chromium } from 'playwright';

/**
 * Abre la página y elimina todo excepto el contenedor .ddc-wrapper y su contenido.
 * Mantiene el navegador abierto al menos `pauseMs` milisegundos para observación.
 * @param {string} url
 * @param {{ headless?: boolean, pauseMs?: number }} options
 * @returns {Promise<{ url: string, keptWrapper: boolean }>} 
 */
export const previewTextReading = async (url, options = {}) => {
  const headless = options.headless ?? false; // por defecto visual
  const pauseMs = options.pauseMs ?? 5000; // al menos 5s

  let browser;
  try {
    // Abrir el navegador en modo pantalla completa (flag) cuando no es headless
    browser = await chromium.launch({
      headless,
      args: headless ? [] : ['--start-fullscreen']
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Asegurar ventana al frente y forzar fullscreen por teclado (fallback)
    try {
      await page.bringToFront();
      // En muchos sistemas F11 activa pantalla completa
      await page.keyboard.press('F11');
    } catch {}
    // Fallback para macOS: Cmd+Ctrl+F
    try {
      await page.keyboard.press('Meta+Control+F');
    } catch {}

    const keptWrapper = await page.evaluate(() => {
      const wrapper = document.querySelector('.ddc-wrapper');
      if (!wrapper) return false;
      try {
        // Mover el wrapper a body y dejarlo como único hijo visible
        document.body.innerHTML = '';
        document.body.appendChild(wrapper);

        // Eliminar elementos de inventario dentro del wrapper (filtros/sort y búsqueda)
        const selectors = [
          "[data-name^='inventory-search-results-page-filters-sort-']",
          "[data-name^='inventory-search-results-facets-']",
          '#inventory-results1-app-root',
          '#inventory-search1-app-root',
          '#inventory-filters1-app-root',
          '#inventory-facets1-app-root',
          // Elemento 4: formulario centrado / contact-form
          "[data-name^='form-centered']",
          "[data-widget-name='contact-form']",
          // Elemento 5: mapa y horarios / map-dynamic
          "[data-name^='map-hours']",
          "[data-name='map-1']",
          "[data-widget-name='map-dynamic']",
          '.ws-inv-text-search',
          '.ws-inv-filters',
          '.ws-inv-facets',
          '.srp-wrapper-facets'
        ];
        selectors.forEach(sel => {
          wrapper.querySelectorAll(sel).forEach(el => el.remove());
        });
        return true;
      } catch (e) {
        return false;
      }
    });

    // Pausa para observación
    await page.waitForTimeout(Math.max(5000, pauseMs));

    // Extraer el texto "renderizado" preservando el orden y saltos
    const rawText = await page.evaluate(() => {
      const wrapper = document.querySelector('.ddc-wrapper');
      if (!wrapper) return '';
      // innerText incluye nodos de texto sueltos y respeta saltos de línea visuales
      return wrapper.innerText || '';
    });

    // Normalización del texto
    const normalized = rawText
      // Reemplazar guiones largos por cortos
      .replace(/[\u2014\u2013]/g, '-')
      // Dividir por líneas para mantener saltos y limpiar cada línea
      .split(/\r?\n/)
      .map(line => {
        return line
          .toLowerCase()
          // Colapsar múltiples espacios en uno solo (por línea)
          .replace(/\s+/g, ' ')
          // Quitar espacios al inicio/fin de la línea
          .trim();
      })
      // Volver a unir respetando los saltos originales
      .join('\n');

    return normalized;
  } finally {
    if (browser) await browser.close();
  }
};
