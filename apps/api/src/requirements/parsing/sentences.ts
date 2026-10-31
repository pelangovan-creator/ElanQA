/** Abbreviations that end with a period but do not end a sentence. */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'no', 'nos', 'fig', 'figs', 'approx', 'incl',
  'dept', 'est', 'max', 'min', 'avg', 'ref', 'refs', 'sec', 'cf', 'al', 'inc', 'ltd', 'co', 'corp', 'jan', 'feb', 'mar', 'apr',
  'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'a.m', 'p.m', 'rs', 'ver', 'v', 'pp', 'para', 'viz', 'resp',
]);

/**
 * Split text into sentences without losing a single character of content:
 * the concatenation of the returned sentences (joined by single spaces) equals the
 * whitespace-normalised input. Handles abbreviations, decimals, URLs, emails, versions.
 */
export function splitSentences(text: string): string[] {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
    // consume trailing punctuation / closing quotes / brackets
    let end = i + 1;
    while (end < s.length && /[.!?…"'”’)\]]/.test(s[end])) end++;
    if (end >= s.length) break;
    if (s[end] !== ' ') { i = end - 1; continue; } // e.g. "3.5", "www.site.com", "v1.2"
    const next = s[end + 1] ?? '';
    // Next sentence should start with an upper-case letter, digit, quote or bracket.
    if (!/[A-Z0-9"“'‘(\[•]/.test(next)) { i = end - 1; continue; }
    if (ch === '.') {
      const wordBefore = /([A-Za-z.]+)\.$/.exec(s.slice(start, i + 1))?.[1]?.toLowerCase() ?? '';
      if (ABBREVIATIONS.has(wordBefore) || ABBREVIATIONS.has(wordBefore.replace(/\.$/, ''))) { i = end - 1; continue; }
      if (/^[a-z]$/i.test(wordBefore)) { i = end - 1; continue; } // initials: "J. Smith", "a. option"
    }
    out.push(s.slice(start, end).trim());
    start = end + 1;
    i = end;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}
