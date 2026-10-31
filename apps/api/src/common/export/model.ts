/** Format-neutral document model rendered to XLSX, PDF and DOCX. */
export type Highlight = 'red' | 'amber' | 'green' | undefined;

export interface ExportColumn { header: string; key: string; width?: number }
export interface ExportTable {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  /** Row highlight - e.g. red for Blocker/Critical/P1 or unmapped requirements. */
  highlight?: (row: Record<string, unknown>) => Highlight;
  /** Sheet name in Excel (defaults to the section heading). */
  sheetName?: string;
}
export interface ExportImage { caption: string; data: Buffer; mimeType: string }
export interface ExportSection {
  heading: string;
  /** Screenshots (embedded in PDF and Word; listed by caption in Excel). */
  images?: ExportImage[];
  level?: 1 | 2;
  paragraphs?: string[];
  bullets?: string[];
  keyValues?: [string, string][];
  table?: ExportTable;
}
export interface ExportDoc {
  title: string;
  subtitle?: string;
  meta?: [string, string][];
  /** Prominent notice, e.g. "AI-generated – pending review". */
  banner?: string;
  landscape?: boolean;
  sections: ExportSection[];
}
export type ExportFormat = 'xlsx' | 'pdf' | 'docx';
export const EXPORT_FORMATS: ExportFormat[] = ['xlsx', 'pdf', 'docx'];

export const MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(cellText).join(', ');
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Y' : 'N';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Pixel size of a PNG/JPEG/GIF/WebP buffer (header only; undefined when unknown). */
export function imageSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return undefined;
}
