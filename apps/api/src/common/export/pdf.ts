import type { Browser } from 'playwright';
import { cellText, ExportDoc } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const multiline = (s: string) => esc(s).replace(/\n/g, '<br>');

export function toHtml(doc: ExportDoc): string {
  const sec = doc.sections.map((s) => {
    const h = s.level === 2 ? 'h3' : 'h2';
    let out = `<section><${h}>${esc(s.heading)}</${h}>`;
    for (const p of s.paragraphs ?? []) out += `<p>${multiline(p)}</p>`;
    if (s.images?.length) out += `<div class="imgs">${s.images.map((im) => `<figure><img alt="${esc(im.caption)}" src="data:${esc(im.mimeType)};base64,${im.data.toString('base64')}"><figcaption>${esc(im.caption)}</figcaption></figure>`).join('')}</div>`;
    if (s.bullets?.length) out += `<ul>${s.bullets.map((b) => `<li>${multiline(b)}</li>`).join('')}</ul>`;
    if (s.keyValues?.length) out += `<table class="kv">${s.keyValues.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${multiline(v)}</td></tr>`).join('')}</table>`;
    if (s.table) {
      const t = s.table;
      out += `<table><thead><tr>${t.columns.map((c) => `<th>${esc(c.header)}</th>`).join('')}</tr></thead><tbody>`;
      out += t.rows.map((r) => `<tr class="${t.highlight?.(r) ?? ''}">${t.columns.map((c) => `<td>${multiline(cellText(r[c.key]))}</td>`).join('')}</tr>`).join('');
      out += `</tbody></table>`;
      if (!t.rows.length) out += `<p class="muted">No entries.</p>`;
    }
    return out + '</section>';
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#0f172a;margin:0}
    h1{font-size:20pt;color:#102f66;margin:0 0 4px} h2{font-size:13pt;color:#102f66;border-bottom:2px solid #102f66;padding-bottom:2px;margin-top:18px}
    h3{font-size:11pt;margin-top:12px} .sub{color:#475569;margin:0 0 8px}
    .banner{background:#fef3c7;border:1px solid #f59e0b;color:#7c2d12;padding:6px 8px;font-weight:bold;margin:8px 0}
    table{border-collapse:collapse;width:100%;margin:6px 0;page-break-inside:auto} tr{page-break-inside:avoid}
    th,td{border:1px solid #cbd5e1;padding:3px 5px;text-align:left;vertical-align:top;font-size:8.5pt}
    thead th{background:#102f66;color:#fff} thead{display:table-header-group}
    table.kv th{width:28%;background:#f1f5f9;color:#0f172a}
    tr.red td{background:#fde2e2;color:#991b1b;font-weight:bold} tr.amber td{background:#fef3c7} tr.green td{background:#dcfce7}
    .muted{color:#64748b;font-style:italic}
    .imgs{display:flex;flex-wrap:wrap;gap:8px} figure{margin:0;width:48%;page-break-inside:avoid} figure img{width:100%;border:1px solid #cbd5e1} figcaption{font-size:8pt;color:#475569}
  </style></head><body><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
  ${doc.banner ? `<div class="banner">${esc(doc.banner)}</div>` : ''}
  ${doc.meta?.length ? `<table class="kv">${doc.meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
  ${sec}</body></html>`;
}

let browserPromise: Promise<Browser> | null = null;
async function browser(): Promise<Browser> {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({ args: ['--no-sandbox'] }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}
export async function closePdfBrowser() {
  if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; await b?.close(); }
}

/** HTML → PDF with Chromium (shared browser instance, isolated context per document, no network). */
export async function renderPdf(doc: ExportDoc): Promise<Buffer> {
  const ctx = await (await browser()).newContext({ javaScriptEnabled: false });
  try {
    await ctx.route('**/*', (r) => r.abort());
    const page = await ctx.newPage();
    await page.setContent(toHtml(doc), { waitUntil: 'domcontentloaded' });
    return await page.pdf({
      format: 'A4', landscape: !!doc.landscape, printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7pt;color:#64748b;width:100%;padding:0 10mm">${esc(doc.title)}</div>`,
      footerTemplate: '<div style="font-size:7pt;color:#64748b;width:100%;text-align:right;padding:0 10mm">QA Pilot · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    await ctx.close();
  }
}

/** Render a self-contained HTML page to a PNG (no network, no JavaScript). */
export async function renderPng(html: string, width = 1200, height = 750, scale = 1): Promise<Buffer> {
  const ctx = await (await browser()).newContext({ javaScriptEnabled: false, viewport: { width, height }, deviceScaleFactor: scale });
  try {
    await ctx.route('**/*', (r) => r.abort());
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.screenshot({ type: 'png' });
  } finally {
    await ctx.close();
  }
}
