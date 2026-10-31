import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { Block, ParsedDocument } from './types';

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('error' in v) return String(v.error);
    return '';
  }
  return String(v);
}

const rowsToDoc = (tables: { label?: string; rows: string[][] }[], warnings: string[]): ParsedDocument => {
  const blocks: Block[] = [];
  const raw: string[] = [];
  for (const t of tables) {
    const rows = t.rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim())).filter((r) => r.some((c) => c));
    if (!rows.length) continue;
    if (t.label) { blocks.push({ kind: 'Header', text: t.label, label: t.label }); raw.push(t.label); }
    blocks.push({ kind: 'Table', text: '', rows, headerRow: rows.length > 1, label: t.label });
    rows.forEach((r) => raw.push(r.join('\t')));
  }
  return { rawText: raw.join('\n'), blocks, ocrUsed: false, warnings };
};

/** XLSX: every non-empty sheet is a table; the sheet name is a header. Each row/cell becomes an item. */
export async function parseXlsx(buffer: Buffer): Promise<ParsedDocument> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const tables: { label: string; rows: string[][] }[] = [];
  const warnings: string[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    const width = ws.actualColumnCount || ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
      rows.push(cells);
    });
    if (ws.state !== 'visible') warnings.push(`Sheet "${ws.name}" is hidden - its content was still extracted.`);
    tables.push({ label: ws.name, rows });
  });
  return rowsToDoc(tables, warnings);
}

export function parseCsv(text: string): ParsedDocument {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  const warnings = res.errors.slice(0, 10).map((e) => `CSV row ${e.row}: ${e.message}`);
  return rowsToDoc([{ rows: res.data }], warnings);
}
