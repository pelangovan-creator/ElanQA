import { readFileSync, readdirSync } from 'node:fs';
import { parseDocument } from '../src/requirements/parsing';
import { atomize } from '../src/requirements/analysis/atomizer';
import { reverseCheck } from '../src/requirements/analysis/reverse-check';
import { classify } from '../src/requirements/analysis/classifier';
(async () => {
  const dir = '/home/user/qa-pilot/apps/api/test/fixtures';
  const only = process.argv[2];
  for (const f of readdirSync(dir).filter((f) => !only || f === only)) {
    const t0 = Date.now();
    const p = await parseDocument(readFileSync(`${dir}/${f}`), f);
    const { items } = atomize(p.blocks, 1);
    const rc = reverseCheck(p.rawText, items.filter((i) => i.isLeaf).map((i) => i.text));
    console.log(`\n=== ${f}: ${items.length} items, words ${rc.originalWords}/${rc.extractedWords}, ok=${rc.ok}, ocr=${p.ocrUsed}, ${Date.now() - t0}ms`, rc.missing.length ? 'MISSING ' + JSON.stringify(rc.missing) : '', rc.extra.length ? 'EXTRA ' + JSON.stringify(rc.extra) : '', p.warnings.length ? 'WARN ' + p.warnings.join(' | ') : '');
    if (only) for (const i of items) console.log(`  ${i.reqId.padEnd(14)} ${i.sourceKind.padEnd(9)} p${i.page ?? '-'} §${i.section ?? '-'} [${classify(i.text, i.sourceKind, i.isTableHeader).category}] ${i.text}`);
  }
})();
