import { readFileSync } from 'node:fs';
import { parseDocument } from '../src/requirements/parsing';
import { atomize } from '../src/requirements/analysis/atomizer';
import { classify } from '../src/requirements/analysis/classifier';
import { designForItem, moduleName } from '../src/artefacts/design/generator';
(async () => {
  const f = process.argv[2];
  const p = await parseDocument(readFileSync(f), f);
  const { items } = atomize(p.blocks, 1);
  let n = 0;
  for (const it of items.filter((i) => i.sourceKind !== 'Header')) {
    const c = classify(it.text, it.sourceKind);
    if (['Informational', 'OutOfScope', 'Assumption'].includes(c.category)) { console.log(`-- ${it.reqId} [${c.category}] ${it.text}`); continue; }
    const out = designForItem({ id: it.reqId, reqId: it.reqId, text: it.text, category: c.category, subCategory: c.subCategory, sourceKind: it.sourceKind, module: moduleName(it.sectionTitle, 'Doc') }, () => `K${++n}`);
    console.log(`\n${it.reqId} [${c.category}/${c.subCategory ?? ''}] ${it.text}`);
    for (const t of out.cases) console.log(`   ${t.module} | ${t.technique} | ${t.testType} | auto=${t.automationCandidate} | ${t.title}`);
    for (const d of out.data) console.log(`   DATA ${d.fieldName}/${d.dataType} valid=${JSON.stringify(d.validValues)} bounds=${JSON.stringify(d.boundaryValues)}`);
  }
})();
