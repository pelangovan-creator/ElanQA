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
export interface ExportSection {
  heading: string;
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
