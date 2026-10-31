import ExcelJS from 'exceljs';
import { ExportDoc } from './model';
import { renderXlsx } from './xlsx';
import { renderDocx } from './docx';
import { closePdfBrowser, renderPdf, toHtml } from './pdf';

const doc: ExportDoc = {
  title: 'Test Cases <script>', banner: 'AI-generated – pending review', meta: [['Project', 'SHOP']],
  sections: [
    { heading: 'Scope', paragraphs: ['Line 1\nLine 2'], bullets: ['=HYPERLINK("x")'] },
    { heading: 'Cases', table: { columns: [{ header: 'ID', key: 'id' }, { header: 'Sev', key: 'sev' }], rows: [{ id: 'TC-1', sev: 'Blocker' }, { id: 'TC-2', sev: 'Minor' }], highlight: (r) => (r.sev === 'Blocker' ? 'red' : undefined) } },
  ],
};

describe('export engine', () => {
  afterAll(() => closePdfBrowser());

  it('xlsx: summary + one sheet per table, highlights, formula guard', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderXlsx(doc)) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Cases']);
    const cases = wb.getWorksheet('Cases')!;
    expect(cases.getRow(2).getCell(1).value).toBe('TC-1');
    expect((cases.getRow(2).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFDE2E2');
    const texts = wb.getWorksheet('Summary')!.getSheetValues().flat().map(String);
    expect(texts.some((t) => t.startsWith("'• =HYPERLINK") || t.startsWith('• =HYPERLINK'))).toBe(true);
    expect(texts.some((t) => t.startsWith('=HYPERLINK'))).toBe(false);
  });

  it('html escapes content', () => {
    const html = toHtml(doc);
    expect(html).toContain('Test Cases &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<tr class="red">');
  });

  it('pdf renders', async () => {
    const pdf = await renderPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);

  it('docx renders a valid zip', async () => {
    const d = await renderDocx(doc);
    expect(d.subarray(0, 2).toString()).toBe('PK');
  });
});
