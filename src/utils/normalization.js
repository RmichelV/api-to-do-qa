// Función de normalización compartida (cliente/servidor debería usar esta como fuente de verdad)
export const normalizeText = (raw) => {
  if (!raw) return '';
  return raw
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2014\u2013]/g, '-')
    .split(/\r?\n/)
    .map(line => line.toLowerCase().replace(/\s+/g, ' ').trim())
    .join('\n');
};
