import { chromium } from 'playwright';

/**
 * Servicio para investigar una página web.
 * @param {string} url - La dirección web a visitar.
 * @param {array<string>} selectorsToRemove
 * @returns {Promise<string>} - El título de la página.
 */
export const scrapePage = async (url, selectorsToRemove = []) => {
    let browser;
    try {
        // Lanzamos el navegador (headless: true significa que no veremos la ventana, es más rápido)
        // Puedes poner headless: false si quieres ver qué hace.
        browser = await chromium.launch({ headless: false });
        
        // Contexto nuevo (como una sesión de incógnito)
        const context = await browser.newContext();
        
        // Pestaña nueva
        const page = await context.newPage();
        
        // Vamos a la URL
        await page.goto(url);
        
        //parte para la eliminacion de elementos no deseados
        if(selectorsToRemove.length > 0){
            await page.evaluate((selectors) => {
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                });
            }, selectorsToRemove);
        }
        // Obtenemos el título
        const pageTitle = await page.title();
        
        // Obtenemos el contenido HTML limpio (solo el body innerHTML para no traer doctype y html tags externos)
        const cleanedContent = await page.evaluate(() => document.body.innerText);

        return { title: pageTitle, content: cleanedContent };
    } catch (error) {
        console.error('Error en scrapeService:', error);
        throw error; // Lanzamos el error para que lo maneje el controlador
    } finally {
        // SIEMPRE cerramos el navegador, incluso si hubo error, para no dejar procesos zombies.
        if (browser) {
            await browser.close();
        }
    }
};
