import express from 'express';
import textReadingRoutes from './routes/textReadingRoutes.js'
import textReadingMobileRoutes from './routes/textReadingMobileRoutes.js'
import linkReadingRoutes from './routes/linkReadingRoutes.js'
import anchorReadingRoutes from './routes/anchorReadingRoutes.js'
import fullAnalysisRoutes from './routes/fullAnalysisRoutes.js'
import { activeBrowsers } from './services/textReadingService.js'
import { activeBrowsersMobile } from './services/textReadingMobileService.js'
import { activeBrowsersLink } from './services/linkReadingService.js'
import { activeBrowsersAnchor } from './services/anchorReadingService.js'
import { activeBrowsersFull } from './services/fullAnalysisService.js'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));

// Servir la carpeta 'public' como archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Ruta antigua desactivada mientras arrancamos text-reading desde cero
// app.use('/api/qa-v2', qaRoutesV2);
app.use('/api/text-reading', textReadingRoutes);
app.use('/api/text-reading-mobile', textReadingMobileRoutes);
app.use('/api/link-reading', linkReadingRoutes);
app.use('/api/anchor-reading', anchorReadingRoutes);
app.use('/api/full-analysis', fullAnalysisRoutes);

// Endpoint para cancelar/detener todos los procesos activos
app.post('/api/cancel', async (req, res) => {
  let closed = 0;
  const allSets = [activeBrowsers, activeBrowsersMobile, activeBrowsersLink, activeBrowsersAnchor, activeBrowsersFull];
  for (const set of allSets) {
    for (const browser of set) {
      try { await browser.close(); closed++; } catch {}
    }
    set.clear();
  }
  console.log(`[cancel] Cerrados ${closed} browsers activos`);
  res.json({ cancelled: true, browsersClosed: closed });
});

app.listen(PORT, () =>{
    console.log(`Server is running on http://localhost:${PORT}`)
})