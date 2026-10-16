import { scrapePageImages } from '../utils/scrapeUtils.js';

export const classifyImage = (image, pageUrl) => {
  let imageUrl = null;
  if (typeof image.src === 'string' && image.src.trim()) {
    try {
      const parsed = new URL(image.src, pageUrl);
      if (['http:', 'https:'].includes(parsed.protocol)) imageUrl = parsed.href;
    } catch {}
  }

  let ddcHosted = false;
  if (imageUrl) {
    const parsed = new URL(imageUrl);
    const allowedDdcHosts = ['pictures.dealer.com', 'images.dealer.com'];
    ddcHosted = parsed.protocol === 'https:' && allowedDdcHosts.includes(parsed.hostname.toLowerCase());
  }
  const hasAlt = typeof image.alt === 'string' && image.alt.trim().length > 0;
  const hasTitle = typeof image.title === 'string' && image.title.trim().length > 0;
  const titleRequired = image.titleRequired !== false;
  const titleValid = !titleRequired || hasTitle;

  return {
    ...image,
    imageUrl,
    ddcHosted,
    hasAlt,
    hasTitle,
    titleRequired,
    status: ddcHosted && hasAlt && titleValid ? 'Passed' : 'Failed',
  };
};

export const readImages = async (url) => {
  console.log(`[image-reading] Fetch+clean images: ${url}`);
  const scrapedImages = await scrapePageImages(url);
  const images = scrapedImages.map(image => classifyImage(image, url));
  console.log(`[image-reading] Found ${images.length} images`);
  return { images };
};
