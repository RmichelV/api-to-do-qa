import { scrapePage } from '../services/scrapeServiceV2.js';

export const analyzeContent = async(req, res)=>{
    try{
        const { url, remove, expectedTexts } = req.body;

        // Validamos que expectedTexts sea un array si viene
        const textosEsperados = Array.isArray(expectedTexts) ? expectedTexts : [];
        const selectors = Array.isArray(remove)? remove : [];

        if(!url){
            return res.status(400).json({
                error: 'Falta la url de la pagina a analizar'
            });
        }

        // Enviamos todo al servicio
        const result = await scrapePage(url, selectors, textosEsperados);
        
        res.status(200).json({
            url, 
            ...result
        });
    }
    catch(error){
        res.status(500).json({
            error: 'No se pudo analizar la URL',
            detalles: error.message
        });
    }
}