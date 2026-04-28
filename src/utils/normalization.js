// Función de normalización compartida (cliente/servidor debería usar esta como fuente de verdad)

const BLOCK_TAGS_REGEX = /<(\/)?(address|article|aside|blockquote|br|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|td|th|ul)\b[^>]*>/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const HTML_ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

const decodeHtmlEntities = (text) => {
  let decoded = text;
  for (const [entity, value] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replaceAll(entity, value);
  }
  decoded = decoded.replace(/&#(\d+);/g, (_, code) => {
    const num = Number(code);
    return Number.isNaN(num) ? _ : String.fromCharCode(num);
  });
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const num = Number.parseInt(code, 16);
    return Number.isNaN(num) ? _ : String.fromCharCode(num);
  });
  return decoded;
};

const stripHtmlToText = (raw) => {
  if (!/<[^>]+>/.test(raw)) return raw;

  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK_TAGS_REGEX, '\n')
    .replace(HTML_TAG_REGEX, '');
};

export const normalizeText = (raw) => {
  if (!raw) return '';

  const stripped = stripHtmlToText(String(raw));
  const decoded = decodeHtmlEntities(stripped);

  return decoded
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2014\u2013]/g, '-')
    .split(/\r?\n/)
    .map(line => line.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
};
