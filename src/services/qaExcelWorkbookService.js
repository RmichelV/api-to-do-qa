import ExcelJS from 'exceljs';

const PASS_FILL = 'FFDDF3E4';
const FAIL_FILL = 'FFFCE1E1';
const PASS_FONT = 'FF166534';
const FAIL_FONT = 'FF991B1B';

const detailsCell = (status, details, heading) => {
  if (!details.length) return status;
  return `${status}\n${heading}:\n${details.map(detail => `• ${detail}`).join('\n')}`;
};

const statusCell = (row, column, passed) => {
  const cell = row.getCell(column);
  const fillColor = passed === null ? 'FFF3F4F6' : passed ? PASS_FILL : FAIL_FILL;
  const fontColor = passed === null ? 'FF475569' : passed ? PASS_FONT : FAIL_FONT;
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: fillColor },
  };
  cell.font = { color: { argb: fontColor }, bold: true };
};

export const createQaExcelWorkbook = async (results) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QA API Tester';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('QA Results');
  worksheet.columns = [
    { header: 'Deliverable Id', key: 'deliverableId', width: 18 },
    { header: 'Website', key: 'website', width: 28 },
    { header: 'Completed Page URL', key: 'completedPageUrl', width: 48 },
    { header: 'Belongs to Dealer', key: 'dealer', width: 20 },
    { header: 'Completed Copy', key: 'copy', width: 48 },
    { header: 'Required Links', key: 'links', width: 42 },
    { header: 'H1', key: 'h1', width: 38 },
    { header: 'Anchors', key: 'anchors', width: 42 },
    { header: 'Images', key: 'images', width: 42 },
    { header: 'Final Status', key: 'finalStatus', width: 16 },
  ];

  const header = worksheet.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A4D' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  for (const result of results) {
    const row = worksheet.addRow({
      deliverableId: result.deliverableId,
      website: result.website,
      completedPageUrl: result.completedPageUrl,
      dealer: result.dealerValidation.isSameDealer ? 'Yes' : 'No',
      copy: result.copyResult.skipped
        ? 'N/A'
        : detailsCell(result.copyResult.passed ? 'Passed' : 'Incomplete', result.copyResult.mismatches, 'Mismatches'),
      links: result.linkResult.skipped
        ? 'N/A'
        : result.linkResult.passed
          ? 'Passed'
          : detailsCell('Incomplete', result.linkResult.missing, 'Missing links'),
      h1: detailsCell(result.h1Result.passed ? 'Passed' : 'Failed', result.h1Result.mismatches, 'Details'),
      anchors: detailsCell(result.anchorResult.passed ? 'Passed' : 'Failed', result.anchorResult.failures, 'Failed anchors'),
      images: detailsCell(result.imageResult.passed ? 'Passed' : 'Failed', result.imageResult.failures, 'Failed images'),
      finalStatus: result.finalStatus,
    });

    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'top', wrapText: true };
    });
    const maxLines = Math.max(...row.values.slice(1).map(value => String(value || '').split('\n').length));
    row.height = Math.min(120, Math.max(30, maxLines * 16));

    statusCell(row, 4, result.dealerValidation.isSameDealer);
    statusCell(row, 5, result.copyResult.skipped ? null : result.copyResult.passed);
    statusCell(row, 6, result.linkResult.skipped ? null : result.linkResult.passed);
    statusCell(row, 7, result.h1Result.passed);
    statusCell(row, 8, result.anchorResult.passed);
    statusCell(row, 9, result.imageResult.passed);
    statusCell(row, 10, result.finalStatus === 'Passed');
  }

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `J${worksheet.rowCount}` };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};