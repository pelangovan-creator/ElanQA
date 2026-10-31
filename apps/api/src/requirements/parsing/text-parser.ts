import { Block } from './types';

const BULLET = /^\s*(?:[-*•▪◦‣–]|\d{1,3}[.)]|[a-zA-Z][.)]|\(\w{1,3}\)|[ivxIVX]{1,5}[.)])\s+(.*)$/;
const NUMBERED_HEADING = /^\s*((?:\d+\.){1,5}\d*|[A-Z]\.\d+(?:\.\d+)*)\s+([A-Z][^.!?]{0,120})$/;
const SIMPLE_NUMBERED_TITLE = /^\s*\d{1,2}\.?\s+[A-Z][\w /&()'-]{1,60}$/;
const NOTE = /^\s*(note|nb|important|warning|caution|tip)\s*[:\-–]/i;
const CAPTION = /^\s*(figure|fig\.|table|image|diagram|screen(?:shot)?|wireframe|exhibit)\s*[\dA-Z.-]*\s*[:\-–]/i;
const FOOTNOTE = /^\s*(?:\[\^?\d+\]:?|\[\d+\]|\*{1,3}(?!\*)|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|†|‡)\s*\S/;
const APPENDIX = /^\s*(appendix|annex|annexure|schedule)\b/i;

/** Heuristic heading detection for plain text / PDF lines. */
export function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120) return false;
  if (NUMBERED_HEADING.test(t) && !/[.!?:;,]$/.test(t)) return true;
  // "2 Checkout", "3. Payment Options" - single-level numbered title, short, no sentence punctuation
  if (/^\d{1,2}\.?\s+[A-Z][\w /&()'-]{1,60}$/.test(t) && t.split(/\s+/).length <= 8 && !/[.!?:;,]$/.test(t)) return true;
  if (APPENDIX.test(t) && t.split(/\s+/).length <= 10) return true;
  // ALL CAPS short line (at least 2 letters, no sentence punctuation)
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 10 && !/[.!?]$/.test(t);
}

function isTableLine(line: string): boolean {
  return /\t/.test(line.trim()) || /^\s*\|.*\|\s*$/.test(line);
}

function splitTableLine(line: string): string[] {
  const t = line.trim();
  if (t.startsWith('|')) return t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  return t.split(/\t+/).map((c) => c.trim());
}

const isMdSeparator = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/**
 * Turns plain text (TXT, Markdown, PDF page text, OCR output) into blocks.
 * Paragraph lines are joined until a blank line or a structural line.
 */
export function parsePlainText(text: string, opts: { markdown?: boolean; page?: number } = {}): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let inAppendix = false;
  let inCode = false;

  const flush = () => {
    if (para.length) blocks.push({ kind: inAppendix ? 'Appendix' : 'Paragraph', text: para.join(' ').replace(/\s+/g, ' ').trim(), page: opts.page });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (opts.markdown && line.startsWith('```')) { flush(); inCode = !inCode; continue; }
    if (inCode) { if (line) blocks.push({ kind: 'Note', text: line, page: opts.page }); continue; }
    if (!line) { flush(); continue; }

    // Tables: consecutive table-like lines.
    if (isTableLine(raw)) {
      flush();
      const rows: string[][] = [];
      let j = i;
      while (j < lines.length && isTableLine(lines[j])) {
        const cells = splitTableLine(lines[j]);
        if (!isMdSeparator(cells)) rows.push(cells);
        j++;
      }
      const hasMdHeader = j > i + 1 && isMdSeparator(splitTableLine(lines[i + 1] ?? ''));
      blocks.push({ kind: 'Table', text: '', rows, headerRow: hasMdHeader || rows.length > 1, page: opts.page });
      i = j - 1;
      continue;
    }

    if (opts.markdown) {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        flush();
        inAppendix = APPENDIX.test(h[2]);
        blocks.push({ kind: 'Header', text: h[2].replace(/#+\s*$/, '').trim(), level: h[1].length, page: opts.page });
        continue;
      }
      if (/^>\s?/.test(line)) { flush(); blocks.push({ kind: 'Note', text: line.replace(/^>\s?/, ''), page: opts.page }); continue; }
      if (/^\[\^[^\]]+\]:/.test(line)) { flush(); blocks.push({ kind: 'Footnote', text: line.replace(/^\[\^[^\]]+\]:\s*/, ''), page: opts.page }); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); continue; } // horizontal rule: no content
    }

    const b = BULLET.exec(raw);
    if (b && !NUMBERED_HEADING.test(line) && !(SIMPLE_NUMBERED_TITLE.test(line) && looksLikeHeading(line) && line.split(/\s+/).length <= 4)) {
      flush();
      const indent = raw.length - raw.trimStart().length;
      blocks.push({ kind: 'Bullet', text: b[1].trim(), level: Math.floor(indent / 2), page: opts.page });
      continue;
    }
    if (looksLikeHeading(line) && para.length === 0) {
      inAppendix = APPENDIX.test(line) || inAppendix;
      blocks.push({ kind: 'Header', text: line, page: opts.page });
      continue;
    }
    if (NOTE.test(line)) { flush(); blocks.push({ kind: 'Note', text: line, page: opts.page }); continue; }
    if (CAPTION.test(line)) { flush(); blocks.push({ kind: 'Caption', text: line, page: opts.page }); continue; }
    if (FOOTNOTE.test(line) && para.length === 0 && line.length < 400) { blocks.push({ kind: 'Footnote', text: line, page: opts.page }); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Strip Markdown syntax for the reverse-check reference text. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '');
}
