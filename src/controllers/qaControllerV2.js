import { scrapePage } from '../services/scrapeServiceV2.js';

export const analyzeContent = async(req, res)=>{
    try{
        const { url, remove, expectedTexts } = req.body;

        // Validamos que expectedTexts sea un array si viene
        const textosEsperados = Array.isArray(expectedTexts) ? expectedTexts : [];
        const selectors = Array.isArray(remove)? remove : [];

        if(!url){
            return res.status(400).json({
                error: 'Missing URL of the page to analyze'
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
            error: 'Could not analyze the URL',
            details: error.message
        });
    }
}