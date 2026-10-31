import { Block } from '../parsing/types';
import { splitSentences } from '../parsing/sentences';

export type SourceKind = 'Sentence' | 'Bullet' | 'TableRow' | 'TableCell' | 'Header' | 'Footnote' | 'Note' | 'Caption' | 'Appendix';

export interface AtomicItem {
  reqId: string; // REQ-001.03 (leaf) or REQ-001 (table row parent)
  parentReqId?: string;
  sequence: number;
  section?: string;
  sectionTitle?: string;
  page?: number;
  sourceKind: SourceKind;
  text: string;
  /** Leaf items together reproduce the document; TableRow parents duplicate their cells. */
  isLeaf: boolean;
  /** Header cells of a table / column headings: structural. */
  isTableHeader?: boolean;
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const SECTION_NO = /^\s*((?:\d+\.)*\d+|[A-Z](?:\.\d+)+|(?:appendix|annex)\s+[A-Z0-9]+)\b[.)]?\s*/i;

/**
 * Splits blocks into atomic items. EVERY sentence, bullet, table row, table cell, header,
 * footnote, note, caption and appendix item becomes an item - nothing is dropped or merged.
 * @param firstBlockNo the first REQ block number to use (reserved from the project counter)
 */
export function atomize(blocks: Block[], firstBlockNo: number): { items: AtomicItem[]; blocksUsed: number } {
  const items: AtomicItem[] = [];
  let blockNo = firstBlockNo - 1;
  let seq = 0;
  let section: string | undefined;
  let sectionTitle: string | undefined;
  const width = 3;

  const add = (i: Omit<AtomicItem, 'sequence' | 'section' | 'sectionTitle'> & { sectionTitle?: string }, page?: number) =>
    items.push({ section, sectionTitle, ...i, page: i.page ?? page, sequence: ++seq });

  for (const b of blocks) {
    blockNo++;
    const base = `REQ-${pad(blockNo, width)}`;
    if (b.kind === 'Header') {
      const m = SECTION_NO.exec(b.text);
      section = m ? m[1] : section;
      sectionTitle = b.text;
      add({ reqId: `${base}.01`, sourceKind: 'Header', text: b.text, isLeaf: true, page: b.page });
      continue;
    }
    if (b.kind === 'Table') {
      const rows = b.rows ?? [];
      const header = b.headerRow ? rows[0] : undefined;
      rows.forEach((row, r) => {
        const rowId = `${base}.${pad(r + 1, 2)}`;
        const isHeaderRow = !!header && r === 0;
        const nonEmpty = row.map((c, ci) => ({ c, ci })).filter((x) => x.c);
        add({ reqId: rowId, sourceKind: 'TableRow', text: row.filter(Boolean).join(' | '), isLeaf: false, page: b.page, isTableHeader: isHeaderRow });
        nonEmpty.forEach(({ c, ci }) =>
          add({ reqId: `${rowId}.${pad(ci + 1, 2)}`, parentReqId: rowId, sourceKind: 'TableCell', text: c, isLeaf: true, page: b.page,
            isTableHeader: isHeaderRow, sectionTitle: header?.[ci] ? `${sectionTitle ?? b.label ?? ''} › ${header[ci]}`.replace(/^ › /, '') : sectionTitle }),
        );
      });
      continue;
    }
    const kind: SourceKind = b.kind === 'Paragraph' ? 'Sentence' : (b.kind as SourceKind);
    const sentences = splitSentences(b.text);
    sentences.forEach((s, i) => add({ reqId: `${base}.${pad(i + 1, 2)}`, sourceKind: kind, text: s, isLeaf: true, page: b.page }));
  }
  return { items, blocksUsed: blockNo - firstBlockNo + 1 };
}
