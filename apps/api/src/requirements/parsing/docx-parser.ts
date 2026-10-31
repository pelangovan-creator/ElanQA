import mammoth from 'mammoth';
import { HTMLElement, parse } from 'node-html-parser';
import { Block, ParsedDocument } from './types';

const CAPTION = /^\s*(figure|fig\.|table|image|diagram|screen(?:shot)?|wireframe|exhibit)\s*[\dA-Z.-]*\s*[:\-–]/i;
const NOTE = /^\s*(note|nb|important|warning|caution|tip)\s*[:\-–]/i;
const APPENDIX = /^\s*(appendix|annex|annexure|schedule)\b/i;

const clean = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Text of an element without footnote reference markers like "[1]". */
function textOf(el: HTMLElement): string {
  const clone = parse(el.outerHTML);
  clone.querySelectorAll('sup a[href^="#footnote"], sup a[href^="#endnote"], a[id^="footnote-ref"], a[id^="endnote-ref"]').forEach((a) => a.remove());
  return clean(clone.textContent);
}

/**
 * DOCX → blocks using mammoth's semantic HTML (headings, lists, tables, footnotes, endnotes).
 * The reverse-check reference text comes from mammoth.extractRawText (an independent pass).
 */
export async function parseDocx(buffer: Buffer): Promise<ParsedDocument> {
  const warnings: string[] = [];
  const [html, raw] = await Promise.all([mammoth.convertToHtml({ buffer }, { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Caption'] => p:fresh"] }), mammoth.extractRawText({ buffer })]);
  html.messages.filter((m) => m.type === 'warning').forEach((m) => warnings.push(`docx: ${m.message}`));
  const root = parse(html.value);
  const blocks: Block[] = [];
  let inAppendix = false;

  const walkList = (list: HTMLElement, level: number) => {
    for (const li of list.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement && n.tagName === 'LI')) {
      // text of the li excluding nested lists
      const copy = parse(li.outerHTML).firstChild as HTMLElement;
      copy.querySelectorAll('ul, ol').forEach((n) => n.remove());
      const t = textOf(copy);
      // Footnote/endnote list items
      const id = li.getAttribute('id') ?? '';
      if (/^(footnote|endnote)-\d+/.test(id)) {
        if (t) blocks.push({ kind: 'Footnote', text: t.replace(/\s*↑\s*$/, '') });
        continue;
      }
      if (t) blocks.push({ kind: inAppendix ? 'Appendix' : 'Bullet', text: t, level });
      li.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => walkList(n, level + 1));
    }
  };

  for (const el of root.childNodes) {
    if (!(el instanceof HTMLElement)) continue;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const t = textOf(el);
      if (!t) continue;
      inAppendix = APPENDIX.test(t) || inAppendix;
      blocks.push({ kind: 'Header', text: t, level: Number(tag[1]) });
    } else if (tag === 'P') {
      const t = textOf(el);
      if (!t) continue;
      if (CAPTION.test(t)) blocks.push({ kind: 'Caption', text: t });
      else if (NOTE.test(t)) blocks.push({ kind: 'Note', text: t });
      else if (APPENDIX.test(t) && t.split(' ').length <= 10) { inAppendix = true; blocks.push({ kind: 'Header', text: t }); }
      else blocks.push({ kind: inAppendix ? 'Appendix' : 'Paragraph', text: t });
    } else if (tag === 'UL' || tag === 'OL') {
      walkList(el, 0);
    } else if (tag === 'TABLE') {
      const rows = el.querySelectorAll('tr').map((tr) => tr.querySelectorAll('th, td').map((c) => textOf(c)));
      const nonEmpty = rows.filter((r) => r.some((c) => c));
      if (nonEmpty.length) blocks.push({ kind: 'Table', text: '', rows: nonEmpty, headerRow: nonEmpty.length > 1 });
    } else if (tag === 'BLOCKQUOTE') {
      const t = textOf(el);
      if (t) blocks.push({ kind: 'Note', text: t });
    } else {
      const t = textOf(el);
      if (t) blocks.push({ kind: 'Paragraph', text: t });
    }
  }
  // Images: mammoth drops images; flag them so a human can check wireframes/screens.
  const imgCount = root.querySelectorAll('img').length;
  if (imgCount) warnings.push(`${imgCount} embedded image(s) found - text inside images is not extracted from DOCX; upload them separately for OCR if they contain requirements.`);
  return { rawText: raw.value, blocks, ocrUsed: false, warnings };
}
