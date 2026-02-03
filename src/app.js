import express from 'express';
import statusRoutes from './routes/statusRoutes.js';
import qaRoutes from './routes/qaRoutes.js';
import qaRoutesV2 from './routes/qaRoutesv2.js'

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Servir la carpeta 'public' como archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

app.use('/api/status', statusRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/qa-v2', qaRoutesV2);

app.listen(PORT, () =>{
    console.log(`Server is running on http://localhost:${PORT}`)
})