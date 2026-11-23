import { parse } from 'csv-parse/sync';
import { detectCsvDelimiter, missingRequiredHeaders } from '../../public/csv-header.js';
import { extractAndValidateAnchors } from './anchorReadingService.js';
import { runFullAnalysis } from './fullAnalysisService.js';
import { validateDealerUrl } from './urlValidationService.js';

const normalizePageUrl = (value) => {
  const input = String(value || '').trim();
  if (!input) throw new Error('Completed Page URL is empty');

  const normalized = input.startsWith('//')
    ? `https:${input}`
    : /^[a-z][a-z\d+.-]*:\/\//i.test(input)
      ? input
      : `https://${input}`;
  const url = new URL(normalized);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Completed Page URL must use HTTP or HTTPS');
  }
  return url.href;
};

export const parseQaCsv = (csvText) => {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('The uploaded CSV is empty');
  }

  let headers = [];
  const records = parse(csvText, {
    bom: true,
    delimiter: detectCsvDelimiter(csvText),
    skip_empty_lines: true,
    columns: (inputHeaders) => {
      headers = inputHeaders.map(header => header.trim());
      const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
      if (duplicates.length) throw new Error(`Duplicate CSV header: ${duplicates[0]}`);

      const missing = missingRequiredHeaders(headers);
      if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);
      return headers;
    },
  });

  if (!records.length) throw new Error('The CSV has no data rows');
  return records;
};

const extractRequiredLinks = (...values) => {
  const links = [];
  const addLink = (value) => {
    const link = value.trim().replace(/^['"]|['"]$/g, '');
    if (link && !links.includes(link)) links.push(link);
  };

  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;

    const hrefPattern = /href=["']([^"']+)["']/gi;
    let match;
    while ((match = hrefPattern.exec(text)) !== null) addLink(match[1]);
    if (hrefPattern.lastIndex > 0) continue;

    text.split(/[\r\n,;]+/).forEach((item) => {
      const token = item.trim();
      if (!token) return;
      if (/^(?:https?:\/\/|\/\/|\/)/i.test(token) || /^[^\s/]+\.[^\s/]+(?:\/.*)?$/.test(token)) {
        addLink(token);
        return;
      }
      if (!/\s/.test(token)) {
        addLink(token);
        return;
      }
      const labeledPath = token.match(/\/[^\s"'<>]+/);
      addLink(labeledPath ? labeledPath[0] : token);
    });
  }

  return links;
};

const canonicalPath = (value) => {
  try {
    const input = String(value || '').trim();
    if (!input) return null;
    const normalized = input.startsWith('//')
      ? `https:${input}`
      : /^[a-z][a-z\d+.-]*:\/\//i.test(input)
        ? input
        : /^[^\s/]+\.[^\s/]+(?:\/.*)?$/.test(input)
          ? `https://${input}`
          : new URL(input.startsWith('/') ? input : `/${input}`, 'https://placeholder.invalid').href;
    const url = new URL(normalized);
    let pathname = url.pathname.toLowerCase().replace(/\/{2,}/g, '/');
    pathname = pathname.replace(/\/index\.(?:htm|html)$/i, '') || '/';
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    return pathname;
  } catch {
    return null;
  }
};

const compareRequiredLinks = (row, anchors) => {
  const requiredLinks = extractRequiredLinks(row.Links, row['Calls to Action']);
  const pagePaths = new Set((anchors || [])
    .map(anchor => canonicalPath(anchor.originalHref || anchor.url))
    .filter(Boolean));
  const missing = requiredLinks.filter(link => {
    const path = canonicalPath(link);
    return !path || !pagePaths.has(path);
  });

  return {
    passed: missing.length === 0,
    skipped: requiredLinks.length === 0,
    required: requiredLinks,
    missing,
  };
};

const getCopyResult = (copy, analysis) => {
  if (!String(copy || '').trim()) return { passed: true, skipped: true, mismatches: [] };
  if (!analysis) return { passed: false, mismatches: ['Page analysis failed'] };

  const mismatches = [];
  for (const [label, view] of [['Desktop', analysis.desktop], ['Mobile', analysis.mobile]]) {
    if (!view?.result) {
      mismatches.push(`${label}: comparison unavailable`);
      continue;
    }
    for (const detail of view.details || []) {
      if (!detail.found) mismatches.push(`${label}: ${detail.line}`);
    }
    if (!view.result.complete && !(view.details || []).some(detail => !detail.found)) {
      mismatches.push(`${label}: copy is incomplete`);
    }
  }

  return { passed: mismatches.length === 0, mismatches };
};

const getH1Result = (analysis) => {
  const comparison = analysis?.h1Comparison;
  const desktop = comparison?.desktop || {};
  const mobile = comparison?.mobile || {};
  const visibleH1s = desktop.h1Texts || [];
  const hasSrOnly = Boolean(desktop.srOnlyText);
  const mismatches = [];

  if (!comparison) mismatches.push('H1 comparison unavailable');
  else if (!comparison.same) {
    if (desktop.h1Texts?.length) mismatches.push(`Desktop H1: ${desktop.h1Texts.join(' | ')}`);
    if (mobile.h1Texts?.length) mismatches.push(`Mobile H1: ${mobile.h1Texts.join(' | ')}`);
    if (desktop.srOnlyText) mismatches.push(`Desktop sr-only: ${desktop.srOnlyText}`);
    if (mobile.srOnlyText) mismatches.push(`Mobile sr-only: ${mobile.srOnlyText}`);
    if (!mismatches.length) mismatches.push('Desktop and mobile H1 differ');
  }

  if (visibleH1s.length > 1) mismatches.push(`Expected at most one visible H1, found ${visibleH1s.length}`);
  if (visibleH1s.length === 0 && !hasSrOnly) mismatches.push('No H1 was found');
  if (visibleH1s.length === 1 && hasSrOnly
    && String(visibleH1s[0]).trim().replace(/\s+/g, ' ').toLowerCase()
      !== String(desktop.srOnlyText).trim().replace(/\s+/g, ' ').toLowerCase()) {
    mismatches.push(`H1 and sr-only H1 differ: ${visibleH1s[0]} | ${desktop.srOnlyText}`);
  }

  return { passed: mismatches.length === 0, mismatches };
};

const getAnchorResult = (result) => {
  if (!result) return { passed: false, failures: ['Anchor check failed'] };
  const failures = [];
  if (result.error) failures.push(result.error);
  for (const anchor of result.anchors || []) {
    if (!anchor.targetExists) failures.push(`${anchor.text}: ${anchor.href} (target not found)`);
  }
  for (const anchor of result.misconfiguredAnchors || []) {
    failures.push(`${anchor.text}: ${anchor.href} (misconfigured)`);
  }
  return { passed: failures.length === 0, failures };
};

const getImageResult = (analysis) => {
  if (!analysis) return { passed: false, failures: ['Image scan unavailable'] };
  const failures = [];
  if (analysis.imageError) failures.push(`Image scan error: ${analysis.imageError}`);
  for (const image of analysis.images || []) {
    if (image.status === 'Passed') continue;
    const issues = [];
    if (!image.ddcHosted) issues.push('not DDC-hosted');
    if (!image.hasAlt) issues.push('missing alt');
    if (image.titleRequired && !image.hasTitle) issues.push('missing title');
    failures.push(`${image.imageUrl || image.src || 'Image'} (${issues.join(', ') || 'failed'})`);
  }
  return { passed: failures.length === 0, failures };
};

export const runQaRow = async (row, services = {}) => {
  const analyzePage = services.analyzePage || runFullAnalysis;
  const analyzeAnchors = services.analyzeAnchors || extractAndValidateAnchors;
  const website = String(row.Website || '').trim();
  const completedPageUrl = String(row['Completed Page URL'] || '').trim();
  const copy = row['Completed Copy'] || '';
  const dealerValidation = validateDealerUrl(website, completedPageUrl);
  let normalizedUrl;
  let analysis = null;
  let anchorData = null;
  let serviceErrors = [];

  try {
    normalizedUrl = normalizePageUrl(completedPageUrl);
  } catch (error) {
    serviceErrors.push(error.message);
  }

  if (normalizedUrl) {
    const [analysisResult, anchorResult] = await Promise.allSettled([
      analyzePage(normalizedUrl, copy, { includeLinkStatuses: false }),
      analyzeAnchors(normalizedUrl),
    ]);
    if (analysisResult.status === 'fulfilled') analysis = analysisResult.value;
    else serviceErrors.push(`Page analysis: ${analysisResult.reason?.message || 'Unknown error'}`);
    if (anchorResult.status === 'fulfilled') anchorData = anchorResult.value;
    else serviceErrors.push(`Anchor check: ${anchorResult.reason?.message || 'Unknown error'}`);
  }

  const copyResult = getCopyResult(copy, analysis);
  const linkResult = normalizedUrl && analysis
    ? compareRequiredLinks(row, analysis.desktop?.anchors)
    : { passed: false, required: extractRequiredLinks(row.Links, row['Calls to Action']), missing: ['Required-link check unavailable'] };
  const h1Result = getH1Result(analysis);
  const anchorResult = getAnchorResult(anchorData);
  const imageResult = getImageResult(analysis);
  const checks = [dealerValidation.isSameDealer, copyResult.passed, linkResult.passed,
    h1Result.passed, anchorResult.passed, imageResult.passed];

  return {
    deliverableId: row['Deliverable Id'] || '',
    website,
    completedPageUrl,
    dealerValidation,
    copyResult,
    linkResult,
    h1Result,
    anchorResult,
    imageResult,
    finalStatus: checks.every(Boolean) && serviceErrors.length === 0 ? 'Passed' : 'Failed',
    serviceErrors,
  };
};

export const runQaCsv = async (csvText, services = {}) => {
  const rows = parseQaCsv(csvText);
  const results = [];
  for (const row of rows) results.push(await runQaRow(row, services));
  return results;
};