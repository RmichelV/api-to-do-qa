import { missingRequiredHeaders, parseCsvHeader } from './csv-header.js';

const fileInput = document.getElementById('csv-file');
const errorBox = document.getElementById('csv-error');
const successBox = document.getElementById('csv-success');
const selectedFile = document.getElementById('csv-selected-file');
const runButton = document.getElementById('csv-run');
const progress = document.getElementById('csv-progress');
const progressLabel = document.getElementById('csv-progress-label');
let selectedCsvFile = null;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  successBox.hidden = true;
}

function clearStatus() {
  errorBox.textContent = '';
  errorBox.hidden = true;
  successBox.textContent = '';
  successBox.hidden = true;
  progressLabel.textContent = '';
  progressLabel.hidden = true;
}

fileInput.addEventListener('change', async () => {
  clearStatus();
  const file = fileInput.files?.[0];
  selectedCsvFile = null;
  runButton.disabled = true;
  selectedFile.hidden = !file;
  selectedFile.textContent = file ? `Selected: ${file.name}` : '';
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.csv')) {
    showError('Choose a file with the .csv extension.');
    return;
  }

  try {
    const headers = parseCsvHeader(await file.text());
    const missing = missingRequiredHeaders(headers);
    if (missing.length > 0) {
      showError(`Missing required columns: ${missing.join(', ')}.`);
      return;
    }
    selectedCsvFile = file;
    runButton.disabled = false;
    successBox.textContent = `${file.name} contains all required columns.`;
    successBox.hidden = false;
  } catch {
    showError('The CSV header is malformed. Check its quotes and try again.');
  }
});

runButton.addEventListener('click', async () => {
  if (!selectedCsvFile) return;
  clearStatus();
  runButton.disabled = true;
  fileInput.disabled = true;
  progress.hidden = false;
  progressLabel.textContent = 'Running QA services for each deliverable…';
  progressLabel.hidden = false;

  try {
    const response = await fetch('/api/admin/qa-excel/run', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: selectedCsvFile,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    const workbook = await response.blob();
    const downloadUrl = URL.createObjectURL(workbook);
    const download = document.createElement('a');
    download.href = downloadUrl;
    download.download = 'qa-results.xlsx';
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    successBox.textContent = 'QA complete. The Excel report has been downloaded.';
    successBox.hidden = false;
    progressLabel.textContent = 'Completed.';
  } catch (error) {
    showError(error.message || 'Unable to process the CSV file.');
    progressLabel.hidden = true;
  } finally {
    runButton.disabled = false;
    fileInput.disabled = false;
    progress.hidden = true;
  }
});