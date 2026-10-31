import ExcelJS from 'exceljs';

export interface SheetSpec {
  name: string;
  title?: string;
  columns: { header: string; key: string; width?: number }[];
  rows: Record<string, unknown>[];
  /** Highlight a row (e.g. red for Blocker/Critical/P1 or unmapped requirements). */
  highlight?: (row: Record<string, unknown>) => 'red' | 'amber' | 'green' | undefined;
}

const FILL = { red: 'FFFDE2E2', amber: 'FFFEF3C7', green: 'FFDCFCE7' } as const;
const cell = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v instanceof Date ? v.toISOString().slice(0, 10) : v ?? '');

/** Build an .xlsx workbook with frozen, bold, filterable header rows. */
export async function toXlsx(sheets: SheetSpec[], meta: { creator?: string } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.creator ?? 'QA Pilot';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102F66' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    for (const r of s.rows) {
      const row = ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, cell(r[c.key])])));
      row.alignment = { vertical: 'top', wrapText: true };
      const h = s.highlight?.(r);
      if (h) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[h] } };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** RFC 4180 CSV with formula-injection protection (cells starting with = + - @ are prefixed). */
export function toCsv(columns: { header: string; key: string }[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    let s = String(cell(v));
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => esc(c.header)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
}
