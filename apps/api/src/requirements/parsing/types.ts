/** Intermediate document structure produced by every parser, before atomisation. */
export type BlockKind = 'Header' | 'Paragraph' | 'Bullet' | 'Table' | 'Footnote' | 'Note' | 'Caption' | 'Appendix';

export interface Block {
  kind: BlockKind;
  text: string; // for Table: unused (see rows)
  page?: number;
  level?: number; // heading level / list nesting
  rows?: string[][]; // Table only; first row is treated as the header row when headerRow = true
  headerRow?: boolean;
  label?: string; // e.g. sheet name
}

export interface ParsedDocument {
  /** Plain text as extracted by an independent pass, used for the reverse check. */
  rawText: string;
  blocks: Block[];
  pageCount?: number;
  ocrUsed: boolean;
  warnings: string[];
}
