import { missingRequiredHeaders, parseCsvHeader } from './csv-header.js';

const fileInput = document.getElementById('csv-file');
const errorBox = document.getElementById('csv-error');
const successBox = document.getElementById('csv-success');
const selectedFile = document.getElementById('csv-selected-file');

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
}

fileInput.addEventListener('change', async () => {
  clearStatus();
  const file = fileInput.files?.[0];
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
    successBox.textContent = `${file.name} contains all required columns.`;
    successBox.hidden = false;
  } catch {
    showError('The CSV header is malformed. Check its quotes and try again.');
  }
});