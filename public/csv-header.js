export const REQUIRED_CSV_HEADERS = [
  'Deliverable Id',
  'Website',
  'URL',
  'Links',
  'Calls to Action',
  'Completed Copy',
  'Completed Page URL',
];

export function parseCsvHeader(text) {
  const source = text.replace(/^\uFEFF/, '');
  const headers = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.trim()) throw new Error('Invalid quote in CSV header.');
      quoted = true;
    } else if (character === ',') {
      headers.push(value.trim());
      value = '';
    } else if (character === '\r' || character === '\n') {
      headers.push(value.trim());
      return headers;
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error('Unclosed quote in CSV header.');
  headers.push(value.trim());
  return headers;
}

export function missingRequiredHeaders(headers) {
  return REQUIRED_CSV_HEADERS.filter((required) => !headers.includes(required));
}