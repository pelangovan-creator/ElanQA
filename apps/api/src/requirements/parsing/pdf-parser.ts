import { PDFParse } from 'pdf-parse';
import { ocrImage } from './ocr';
import { parsePlainText } from './text-parser';
import { Block, ParsedDocument } from './types';

/** Pages with fewer meaningful characters than this are treated as scanned and OCR'd. */
const MIN_TEXT_CHARS = 25;

/** PDF → blocks page by page (page numbers kept). Scanned pages are rendered and OCR'd. */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const parser = new PDFParse({ data: buffer });
  const warnings: string[] = [];
  let ocrUsed = false;
  try {
    const result = await parser.getText();
    const blocks: Block[] = [];
    const pageTexts: string[] = [];
    for (const page of result.pages) {
      let text = page.text ?? '';
      if (text.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
        try {
          const shot = await parser.getScreenshot({ partial: [page.num], scale: 2 } as never);
          const img = shot.pages[0];
          if (img) {
            text = await ocrImage(Buffer.from(img.data));
            ocrUsed = true;
            warnings.push(`Page ${page.num}: no text layer - text recognised by OCR, please verify.`);
          }
        } catch (e) {
          warnings.push(`Page ${page.num}: OCR failed (${(e as Error).message}).`);
        }
      }
      pageTexts.push(text);
      blocks.push(...parsePlainText(text, { page: page.num }));
    }
    return { rawText: pageTexts.join('\n'), blocks, pageCount: result.pages.length, ocrUsed, warnings };
  } finally {
    await parser.destroy();
  }
}
