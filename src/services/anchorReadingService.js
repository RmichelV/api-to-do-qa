import { chromium } from 'playwright';

// Registro global de browsers activos para poder cancelarlos
export const activeBrowsersAnchor = new Set();

/**
 * Extrae anchor links internos (href="#...") de .ddc-wrapper,
 * luego verifica para cada uno:
 *   1. ¿Existe el elemento destino en el DOM?
 *   2. ¿El scroll (posición Y) cambia al hacer click?
 *
 * IMPORTANTE: Solo se elimina lo que está FUERA de .ddc-wrapper.
 * Todo lo que está DENTRO se conserva intacto para que los destinos
 * de los anchors existan y el scroll funcione correctamente.
 */
export const extractAndValidateAnchors = async (url, options = {}) => {
	const headless = options.headless ?? true;
	const pauseMs = options.pauseMs ?? 0;

	let browser;
	try {
		browser = await chromium.launch({ headless });
		activeBrowsersAnchor.add(browser);
		const context = await browser.newContext();
		const page = await context.newPage();
		page.setDefaultTimeout(60000);
		page.setDefaultNavigationTimeout(60000);

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

		// Esperar a que .ddc-wrapper exista
		try {
			await page.waitForSelector('.ddc-wrapper', { timeout: 10000 });
		} catch {
			return { anchors: [], error: 'No se encontró .ddc-wrapper' };
		}

		// Paso 1: Aislar .ddc-wrapper (eliminar todo fuera, mantener todo dentro intacto)
		await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return;
			document.body.innerHTML = '';
			document.body.appendChild(wrapper);
		});

		// Breve espera para que el layout se estabilice
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Paso 2: Extraer los anchor links internos (href="#...")
		const anchorLinks = await page.evaluate(() => {
			const wrapper = document.querySelector('.ddc-wrapper');
			if (!wrapper) return [];

			const results = [];
			wrapper.querySelectorAll('a').forEach(a => {
				const href = a.getAttribute('href') || '';
				// Solo anchors internos: empieza con # y tiene algo después
				if (!href.startsWith('#') || href.length <= 1) return;
				const text = (a.innerText || '').trim();
				if (text.length === 0) return;
				// Verificar que el link sea visible
				const style = window.getComputedStyle(a);
				if (style.display === 'none' || style.visibility === 'hidden') return;
				const rect = a.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;

				results.push({
					text,
					href,
					targetId: href.substring(1) // quitar el #
				});
			});

			// Deduplicar por href (mismo anchor puede aparecer varias veces)
			const seen = new Set();
			return results.filter(r => {
				if (seen.has(r.href)) return false;
				seen.add(r.href);
				return true;
			});
		});

		if (anchorLinks.length === 0) {
			return { anchors: [] };
		}

		// Paso 3: Para cada anchor, verificar existencia del destino y scroll
		const results = [];
		for (const anchor of anchorLinks) {
			// Verificar si el elemento destino existe
			const targetExists = await page.evaluate((id) => {
				return !!document.getElementById(id);
			}, anchor.targetId);

			let scrollOk = false;
			if (targetExists) {
				try {
					// Registrar posición Y antes del click
					const yBefore = await page.evaluate(() => window.scrollY);

					// Primero hacer scroll al top para tener un punto de partida limpio
					await page.evaluate(() => window.scrollTo(0, 0));
					await new Promise(resolve => setTimeout(resolve, 200));

					// Click en el anchor link
					const linkSelector = `a[href="${anchor.href}"]`;
					await page.click(linkSelector, { timeout: 5000 });

					// Esperar a que el scroll termine (smooth scroll puede tardar)
					await new Promise(resolve => setTimeout(resolve, 800));

					// Registrar posición Y después del click
					const yAfter = await page.evaluate(() => window.scrollY);

					// El scroll es OK si la posición Y cambió (se movió de 0)
					scrollOk = yAfter !== 0 || anchor.href === '#top';
				} catch {
					// Si el click falla, el scroll no se pudo verificar
					scrollOk = false;
				}
			}

			results.push({
				text: anchor.text,
				href: anchor.href,
				targetExists,
				scrollOk
			});
		}

		if (pauseMs && pauseMs > 0) {
			await new Promise(resolve => setTimeout(resolve, pauseMs));
		}

		return { anchors: results };
	} finally {
		if (browser) {
			activeBrowsersAnchor.delete(browser);
			try { await browser.close(); } catch {}
		}
	}
};
