import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import { cellText, ExportDoc } from './model';

const SHADE = { red: 'FDE2E2', amber: 'FEF3C7', green: 'DCFCE7' } as const;
const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
const borders = { top: border, bottom: border, left: border, right: border };

const para = (text: string, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
  new Paragraph({ children: text.split('\n').flatMap((line, i) => [...(i ? [new TextRun({ text: '', break: 1 })] : []), new TextRun({ text: line, bold: opts.bold, color: opts.color, size: opts.size })]) });

function table(header: string[], rows: string[][], shades: (string | undefined)[] = []): Table {
  const mk = (cells: string[], head: boolean, shade?: string) => new TableRow({
    tableHeader: head,
    children: cells.map((c) => new TableCell({
      borders,
      shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: '102F66' } : shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
      children: [para(c, { bold: head || shade === SHADE.red, color: head ? 'FFFFFF' : shade === SHADE.red ? '991B1B' : undefined, size: 16 })],
    })),
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [mk(header, true), ...rows.map((r, i) => mk(r, false, shades[i]))] });
}

export async function renderDocx(doc: ExportDoc): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE })];
  if (doc.subtitle) children.push(para(doc.subtitle, { color: '475569' }));
  if (doc.banner) children.push(new Paragraph({ alignment: AlignmentType.LEFT, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FEF3C7' }, children: [new TextRun({ text: doc.banner, bold: true, color: '7C2D12' })] }));
  if (doc.meta?.length) children.push(table(['Field', 'Value'], doc.meta.map(([k, v]) => [k, v])));
  for (const s of doc.sections) {
    children.push(new Paragraph({ text: s.heading, heading: s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1 }));
    for (const p of s.paragraphs ?? []) children.push(para(p));
    for (const b of s.bullets ?? []) children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    if (s.keyValues?.length) children.push(table(['Item', 'Detail'], s.keyValues.map(([k, v]) => [k, v])));
    if (s.table) {
      const t = s.table;
      children.push(table(t.columns.map((c) => c.header), t.rows.map((r) => t.columns.map((c) => cellText(r[c.key]))), t.rows.map((r) => { const h = t.highlight?.(r); return h ? SHADE[h] : undefined; })));
      if (!t.rows.length) children.push(para('No entries.', { color: '64748B' }));
    }
  }
  const document = new Document({
    creator: 'QA Pilot', title: doc.title,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: doc.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT } } }, children }],
  });
  return Packer.toBuffer(document);
}
