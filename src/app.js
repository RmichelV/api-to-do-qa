import express from 'express';
// Import retirado temporalmente: estamos iniciando solo text-reading
// import qaRoutesV2 from './routes/qaRoutesv2.js'
import textReadingRoutes from './routes/textReadingRoutes.js'
import textReadingMobileRoutes from './routes/textReadingMobileRoutes.js'
import linkReadingRoutes from './routes/linkReadingRoutes.js'
import anchorReadingRoutes from './routes/anchorReadingRoutes.js'
import { activeBrowsers } from './services/textReadingService.js'
import { activeBrowsersMobile } from './services/textReadingMobileService.js'
import { activeBrowsersLink } from './services/linkReadingService.js'
import { activeBrowsersAnchor } from './services/anchorReadingService.js'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir la carpeta 'public' como archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Ruta antigua desactivada mientras arrancamos text-reading desde cero
// app.use('/api/qa-v2', qaRoutesV2);
app.use('/api/text-reading', textReadingRoutes);
app.use('/api/text-reading-mobile', textReadingMobileRoutes);
app.use('/api/link-reading', linkReadingRoutes);
app.use('/api/anchor-reading', anchorReadingRoutes);

// Endpoint para cancelar/detener todos los procesos activos
app.post('/api/cancel', async (req, res) => {
  let closed = 0;
  const allSets = [activeBrowsers, activeBrowsersMobile, activeBrowsersLink, activeBrowsersAnchor];
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