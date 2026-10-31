import { dirname, join } from 'node:path';

/**
 * OCR via tesseract.js using the bundled @tesseract.js-data/eng package so it works offline
 * (no CDN download). Override with OCR_LANG_PATH / OCR_LANG for other languages.
 */
export async function ocrImage(image: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const lang = process.env.OCR_LANG ?? 'eng';
  const langPath = process.env.OCR_LANG_PATH ?? join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const worker = await createWorker(lang, 1, { langPath, cacheMethod: 'none', gzip: true });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
