import ExcelJS from 'exceljs';
import { cellText, ExportDoc } from './model';

const FILL = { red: 'FFFDE2E2', amber: 'FFFEF3C7', green: 'FFDCFCE7' } as const;
const safeSheet = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sheet';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
};
/** Formula-injection guard for spreadsheet cells. */
const guard = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

export async function renderXlsx(doc: ExportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QA Pilot';
  wb.created = new Date();
  const used = new Set<string>();
  // Summary sheet with title, meta, narrative sections.
  const sum = wb.addWorksheet(safeSheet('Summary', used));
  sum.columns = [{ width: 34 }, { width: 100 }];
  sum.addRow([doc.title]).font = { bold: true, size: 16 };
  if (doc.subtitle) sum.addRow([doc.subtitle]);
  if (doc.banner) { const r = sum.addRow([doc.banner]); r.font = { bold: true, color: { argb: 'FF9A3412' } }; }
  for (const [k, v] of doc.meta ?? []) { const r = sum.addRow([k, v]); r.getCell(1).font = { bold: true }; }
  for (const s of doc.sections) {
    if (!s.paragraphs && !s.bullets && !s.keyValues) continue;
    sum.addRow([]);
    sum.addRow([s.heading]).font = { bold: true, size: 13 };
    for (const p of s.paragraphs ?? []) { const r = sum.addRow(['', guard(p)]); r.alignment = { wrapText: true, vertical: 'top' }; }
    for (const b of s.bullets ?? []) { const r = sum.addRow(['', guard(`• ${b}`)]); r.alignment = { wrapText: true, vertical: 'top' }; }
    for (const [k, v] of s.keyValues ?? []) { const r = sum.addRow([k, guard(v)]); r.getCell(1).font = { bold: true }; r.alignment = { wrapText: true, vertical: 'top' }; }
    if (s.table) sum.addRow(['', `See sheet "${s.table.sheetName ?? s.heading}"`]).font = { italic: true };
  }
  for (const s of doc.sections.filter((x) => x.table)) {
    const t = s.table!;
    const ws = wb.addWorksheet(safeSheet(t.sheetName ?? s.heading, used));
    ws.columns = t.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF102F66' } };
    head.alignment = { wrapText: true, vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (t.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
    for (const r of t.rows) {
      const row = ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, guard(cellText(r[c.key]))])));
      row.alignment = { wrapText: true, vertical: 'top' };
      const h = t.highlight?.(r);
      if (h) { row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[h] } }; if (h === 'red') row.font = { bold: true, color: { argb: 'FF991B1B' } }; }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
