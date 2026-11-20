import { isIP } from 'node:net';

const extractDealerBrand = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;

  const input = value.trim();
  const normalizedUrl = input.startsWith('//')
    ? `https:${input}`
    : /^[a-z][a-z\d+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`;

  try {
    const url = new URL(normalizedUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || isIP(hostname)) return null;

    const labels = hostname.split('.');
    const brand = labels[0] === 'www' ? labels[1] : labels[0];
    return labels.length >= 2 && brand ? brand : null;
  } catch {
    return null;
  }
};

export const validateDealerUrl = (website, completedPageUrl) => {
  const websiteBrand = extractDealerBrand(website);
  const completedPageBrand = extractDealerBrand(completedPageUrl);

  if (!websiteBrand || !completedPageBrand) {
    return {
      isSameDealer: false,
      websiteBrand,
      completedPageBrand,
      reason: !websiteBrand ? 'invalid-website-url' : 'invalid-completed-page-url',
    };
  }

  const isSameDealer = websiteBrand === completedPageBrand;
  return {
    isSameDealer,
    websiteBrand,
    completedPageBrand,
    reason: isSameDealer ? null : 'different-dealers',
  };
};