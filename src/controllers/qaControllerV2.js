import { scrapePage } from '../services/scrapeServiceV2.js';

export const analyzeContent = async(req, res)=>{
    try{
        const { url, remove} = req.body;

        const selectors = Array.isArray(remove)? remove : [];

        if(!url){
            return res.status(400).json({
                error: 'Falta la url de la pagina a analizar'
            });
        }

        const result = await scrapePage(url, selectors);
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