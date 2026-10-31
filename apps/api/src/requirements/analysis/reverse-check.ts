/** Words: letters/digits sequences (unicode-aware), lower-cased. Punctuation and markup are ignored. */
export function words(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []);
}

export interface ReverseCheck {
  originalWords: number;
  extractedWords: number;
  missing: { word: string; count: number }[];
  extra: { word: string; count: number }[];
  ok: boolean;
}

/**
 * Second-pass check: rebuild the document from the extracted leaf items and compare it,
 * word-for-word (as a multiset), with the independently extracted original text.
 */
export function reverseCheck(originalText: string, extractedTexts: string[]): ReverseCheck {
  const count = (ws: string[]) => ws.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map<string, number>());
  const a = words(originalText);
  const b = words(extractedTexts.join(' '));
  const ca = count(a), cb = count(b);
  const missing: { word: string; count: number }[] = [];
  const extra: { word: string; count: number }[] = [];
  for (const [w, n] of ca) { const d = n - (cb.get(w) ?? 0); if (d > 0) missing.push({ word: w, count: d }); }
  for (const [w, n] of cb) { const d = n - (ca.get(w) ?? 0); if (d > 0) extra.push({ word: w, count: d }); }
  missing.sort((x, y) => y.count - x.count);
  extra.sort((x, y) => y.count - x.count);
  return { originalWords: a.length, extractedWords: b.length, missing: missing.slice(0, 200), extra: extra.slice(0, 200), ok: missing.length === 0 };
}
