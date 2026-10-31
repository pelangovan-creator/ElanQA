import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import { parseDocx } from './docx-parser';
import { ocrImage } from './ocr';
import { parsePdf } from './pdf-parser';
import { parseCsv, parseXlsx } from './sheet-parser';
import { markdownToPlain, parsePlainText } from './text-parser';
import { ParsedDocument } from './types';

export * from './types';

export const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.csv', '.txt', '.md', '.markdown', '.eml', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'] as const;

const decode = (b: Buffer) => b.toString('utf8').replace(/^﻿/, '');

/** Dispatch on file extension (verified against magic bytes for binary formats). */
export async function parseDocument(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const ext = extname(fileName).toLowerCase();
  const magic = buffer.subarray(0, 4).toString('hex');
  const isZip = magic === '504b0304';
  switch (ext) {
    case '.pdf':
      if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new BadRequestException('File is not a valid PDF');
      return parsePdf(buffer);
    case '.docx':
      if (!isZip) throw new BadRequestException('File is not a valid DOCX');
      return parseDocx(buffer);
    case '.xlsx':
      if (!isZip) throw new BadRequestException('File is not a valid XLSX');
      return parseXlsx(buffer);
    case '.csv':
      return parseCsv(decode(buffer));
    case '.md':
    case '.markdown': {
      const text = decode(buffer);
      return { rawText: markdownToPlain(text), blocks: parsePlainText(text, { markdown: true }), ocrUsed: false, warnings: [] };
    }
    case '.txt':
    case '.eml': {
      const text = decode(buffer);
      return { rawText: text, blocks: parsePlainText(text), ocrUsed: false, warnings: [] };
    }
    case '.png': case '.jpg': case '.jpeg': case '.tif': case '.tiff': case '.bmp': case '.webp': {
      const text = await ocrImage(buffer);
      return { rawText: text, blocks: parsePlainText(text), ocrUsed: true, warnings: ['Text recognised by OCR from an image - please verify every item against the original.'] };
    }
    default:
      throw new BadRequestException(`Unsupported file type "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}. (Legacy .doc/.xls: save as .docx/.xlsx.)`);
  }
}
