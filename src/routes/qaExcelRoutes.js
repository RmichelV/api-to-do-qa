import { Router, text } from 'express';
import { runQaCsv } from '../services/qaExcelService.js';
import { createQaExcelWorkbook } from '../services/qaExcelWorkbookService.js';

const router = Router();
const parseCsvBody = text({
  type: ['text/csv', 'application/csv', 'text/plain'],
  limit: '10mb',
});

router.post('/run', parseCsvBody, async (req, res) => {
  let results;
  try {
    results = await runQaCsv(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to read the CSV file' });
  }

  try {
    const workbook = await createQaExcelWorkbook(results);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="qa-results.xlsx"',
      'Cache-Control': 'no-store',
      'Content-Length': workbook.length,
    });
    return res.status(200).send(workbook);
  } catch (error) {
    console.error('[qa-excel] Failed to create workbook:', error?.message);
    return res.status(500).json({ error: 'Unable to generate the Excel report' });
  }
});

export default router;