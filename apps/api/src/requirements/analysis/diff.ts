import { words } from './reverse-check';

export interface DiffInput { key: string; text: string }
export interface DiffResult {
  matches: { oldKey: string; newKey: string; type: 'Unchanged' | 'Modified'; similarity: number }[];
  added: string[]; // new keys
  removed: string[]; // old keys
}

const norm = (t: string) => words(t).join(' ');

/** Sørensen–Dice similarity on word bags. */
export function similarity(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (!wa.length && !wb.length) return 1;
  const m = new Map<string, number>();
  wa.forEach((w) => m.set(w, (m.get(w) ?? 0) + 1));
  let common = 0;
  for (const w of wb) { const n = m.get(w) ?? 0; if (n > 0) { common++; m.set(w, n - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

/**
 * Match items of the previous version to the new version:
 * exact (normalised) text → Unchanged; best remaining match with similarity ≥ threshold → Modified.
 */
export function diffItems(oldItems: DiffInput[], newItems: DiffInput[], threshold = 0.6): DiffResult {
  const matches: DiffResult['matches'] = [];
  const oldByText = new Map<string, string[]>();
  oldItems.forEach((o) => { const k = norm(o.text); oldByText.set(k, [...(oldByText.get(k) ?? []), o.key]); });
  const usedOld = new Set<string>();
  const unmatchedNew: DiffInput[] = [];
  for (const n of newItems) {
    const cands = oldByText.get(norm(n.text));
    const hit = cands?.find((k) => !usedOld.has(k));
    if (hit) { usedOld.add(hit); matches.push({ oldKey: hit, newKey: n.key, type: 'Unchanged', similarity: 1 }); }
    else unmatchedNew.push(n);
  }
  const remainingOld = oldItems.filter((o) => !usedOld.has(o.key));
  // Greedy best-pair matching on similarity.
  const pairs: { o: string; n: string; s: number }[] = [];
  for (const n of unmatchedNew) for (const o of remainingOld) { const s = similarity(o.text, n.text); if (s >= threshold) pairs.push({ o: o.key, n: n.key, s }); }
  pairs.sort((x, y) => y.s - x.s);
  const usedNew = new Set<string>();
  for (const p of pairs) {
    if (usedOld.has(p.o) || usedNew.has(p.n)) continue;
    usedOld.add(p.o); usedNew.add(p.n);
    matches.push({ oldKey: p.o, newKey: p.n, type: 'Modified', similarity: Math.round(p.s * 100) / 100 });
  }
  return {
    matches,
    added: unmatchedNew.filter((n) => !usedNew.has(n.key)).map((n) => n.key),
    removed: oldItems.filter((o) => !usedOld.has(o.key)).map((o) => o.key),
  };
}
