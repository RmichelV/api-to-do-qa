import { chromium } from "playwright";

//este archivo ya es la practica, donde no extraemos ya el titulo, solo el texto tal cual esta en la pagina, con saltos de lineas, espacios dobles , etc.
/**
 * Servicio para investigar una página web.
 * @param {string} url - La dirección web a visitar.
 * @param {array<string>} selectorsToRemove - selectores como clases, styles o js que se eliminaran
 * @return {Promise<string>}- el contenido de la pagina .
 */

export const scrapePage = async (url, selectorsToRemove = [])=> {
    let browser;
    try{
        // Lanzar el navegador (headless: true significa que no se abrira como ventana, pero de ser necesario podemos ponerlo en false para que lo haga)
        browser = await chromium.launch({ headless: true });

        // Contexto nuevo (como una sesión de incógnito)
        const context = await browser.newContext();

        // Pestaña nueva
        const page = await context.newPage();
        
        // Vamos a la URL
        await page.goto(url);

        const defaultSelectors = [
            'script',
            'style',
            'noscript',
            'header',
            'footer',
            '.ddc-header',
            '.ddc-footer',
            '.page-header',
            '.page-footer',
            '.ddc-tracking',
            '.oem-includes',
            '.inventory-listing-ws-inv-data-service', 
            '.ws-inv-data.spacing-reset',
            "[data-name='srp-wrapper-page-title-content']",
            "[data-name='srp-wrapper-page-title-banner']",
            "[data-name='srp-wrapper-page-filters-sort']",
            "[data-name='srp-wrapper-listing-inner-inventory-results']",
            "[data-name='srp-wrapper-listing-inner-inventory-paging']",
            "[data-name='srp-wrapper-page-filters-sort']",  
            "[data-name='srp-wrapper-page-filters-sort-inner']",
            '#inventory-search1-app-root',
            '#inventory-filters1-app-root',
            '.ws-inv-filters',
            '#show-filters-modal-button',
            "[aria-labelledby='ws-inv-filters-modal-label']"
        ];

        const finalSelectors = [...defaultSelectors, ...selectorsToRemove];

        


        // Seccion para eliminar elemenos no deseados 
        // if( selectorsToRemove.length > 0 ){
        //     await page.evaluate((selectors) => {
        //         selectors.forEach(selector => {
        //             document.querySelectorAll(selector).forEach(el=>el.remove());
        //         });
        //     }, selectorsToRemove);
        // }
            await page.evaluate((selectors) => {
                selectors.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el=>el.remove());
                });
            }, finalSelectors);
        
        
        // Obtenemos el contenido HTML limpio (solo de la clase .ddc-wrapper pero en el caso que no haya usaremos el body)
        const cleanedContent = await page.evaluate(() => {
            const contenedorPrincipal = document.querySelector('.ddc-wrapper') || document.body;
            return contenedorPrincipal.innerText;
        });

        return { content: cleanedContent };
        
    }   catch(error){
        console.error('Error en scrapeServiceV2:', error);
        throw error; // Lanzamos el error para que lo maneje el controlador
    }   finally{
        // SIEMPRE cerramos el navegador, incluso si hubo error, para no dejar procesos zombies.
        if(browser){
            await browser.close();
        }
    }
}

