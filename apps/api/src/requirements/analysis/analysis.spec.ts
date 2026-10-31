import { splitSentences } from '../parsing/sentences';
import { parsePlainText } from '../parsing/text-parser';
import { atomize } from './atomizer';
import { classify } from './classifier';
import { findAmbiguities } from './ambiguity';
import { reverseCheck } from './reverse-check';
import { diffItems, similarity } from './diff';

describe('splitSentences', () => {
  it('splits sentences and never loses text', () => {
    const t = 'The user shall log in. E.g. via SSO, i.e. Okta etc. Version 2.5 is at www.acme.com. Max. 3 tries! Then lock? Dr. Rao approves.';
    const s = splitSentences(t);
    expect(s).toEqual(['The user shall log in.', 'E.g. via SSO, i.e. Okta etc. Version 2.5 is at www.acme.com.', 'Max. 3 tries!', 'Then lock?', 'Dr. Rao approves.']);
    expect(s.join(' ')).toBe(t);
  });
  it('keeps a sentence without terminal punctuation', () => expect(splitSentences('No full stop here')).toEqual(['No full stop here']));
});

describe('parsePlainText', () => {
  it('detects headings, bullets, tables, notes, captions, footnotes, appendix', () => {
    const blocks = parsePlainText([
      '1.2 Login Requirements',
      'The system shall lock the account. Users should be notified.',
      '',
      '- Password must be 8-16 characters',
      '  - Must include a digit',
      'Note: SSO is out of scope.',
      'Figure 3: Login screen',
      'Field\tType\tRule',
      'Email\tText\tMandatory',
      '¹ Applies to retail customers only',
      'APPENDIX A',
      'Glossary terms follow.',
    ].join('\n'));
    expect(blocks.map((b) => b.kind)).toEqual(['Header', 'Paragraph', 'Bullet', 'Bullet', 'Note', 'Caption', 'Table', 'Footnote', 'Header', 'Appendix']);
    expect(blocks[3].level).toBe(1);
    expect(blocks[6].rows).toEqual([['Field', 'Type', 'Rule'], ['Email', 'Text', 'Mandatory']]);
  });
  it('parses markdown tables and headings', () => {
    const blocks = parsePlainText('# Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[^1]: A footnote.', { markdown: true });
    expect(blocks.map((b) => b.kind)).toEqual(['Header', 'Table', 'Footnote']);
    expect(blocks[1].rows).toEqual([['A', 'B'], ['1', '2']]);
  });
});

describe('atomize', () => {
  const blocks = parsePlainText('2 Checkout\nThe cart shall show totals. Tax may apply.\nField\tRule\nCard\tMandatory');
  const { items, blocksUsed } = atomize(blocks, 7);
  it('creates hierarchical IDs from the reserved block number', () => {
    expect(items.map((i) => [i.reqId, i.sourceKind, i.text])).toEqual([
      ['REQ-007.01', 'Header', '2 Checkout'],
      ['REQ-008.01', 'Sentence', 'The cart shall show totals.'],
      ['REQ-008.02', 'Sentence', 'Tax may apply.'],
      ['REQ-009.01', 'TableRow', 'Field | Rule'],
      ['REQ-009.01.01', 'TableCell', 'Field'],
      ['REQ-009.01.02', 'TableCell', 'Rule'],
      ['REQ-009.02', 'TableRow', 'Card | Mandatory'],
      ['REQ-009.02.01', 'TableCell', 'Card'],
      ['REQ-009.02.02', 'TableCell', 'Mandatory'],
    ]);
    expect(blocksUsed).toBe(3);
  });
  it('tracks section and column context', () => {
    expect(items[1].section).toBe('2');
    expect(items[8].sectionTitle).toContain('Rule');
    expect(items[4].isTableHeader).toBe(true);
  });
  it('reverse check passes when leaves are rebuilt', () => {
    const rc = reverseCheck('2 Checkout\nThe cart shall show totals. Tax may apply.\nField\tRule\nCard\tMandatory', items.filter((i) => i.isLeaf).map((i) => i.text));
    expect(rc).toMatchObject({ ok: true, originalWords: 14, extractedWords: 14, missing: [] });
  });
});

describe('reverseCheck', () => {
  it('reports dropped words', () => {
    const rc = reverseCheck('Users must reset password every 90 days', ['Users must reset password']);
    expect(rc.ok).toBe(false);
    expect(rc.missing.map((m) => m.word)).toEqual(['every', '90', 'days']);
  });
});

describe('classify', () => {
  it.each([
    ['Search results shall load within 2 seconds for 500 concurrent users.', 'NonFunctional', 'performance'],
    ['Passwords must be encrypted with bcrypt.', 'NonFunctional', 'security'],
    ['The site must meet WCAG 2.2 AA.', 'NonFunctional', 'accessibility'],
    ['Payroll integration is out of scope for this release.', 'OutOfScope', undefined],
    ['We assume users have a valid email.', 'Assumption', undefined],
    ['Email is a mandatory field.', 'Validation', undefined],
    ['Orders above 5000 get a 10% discount.', 'BusinessRule', undefined],
    ['Payments are processed through the Razorpay API.', 'Integration', undefined],
    ['A Submit button is displayed on the page.', 'UIUX', undefined],
    ['The user can cancel an order.', 'Functional', undefined],
    ['This document describes the project.', 'Informational', undefined],
  ])('%s → %s', (text, cat, sub) => {
    const c = classify(text, 'Sentence');
    expect(c.category).toBe(cat);
    expect(c.subCategory).toBe(sub);
  });
  it('treats headers as informational', () => expect(classify('Login', 'Header').category).toBe('Informational'));
});

describe('findAmbiguities', () => {
  it('flags vague terms', () => {
    expect(findAmbiguities('The page should load fast, approximately 2s, etc.')).toEqual(['should', 'fast/quick', 'etc.', 'approximately']);
    expect(findAmbiguities('Limit is TBD.')).toEqual(['TBD']);
    expect(findAmbiguities('The system shall lock after 3 failed attempts.')).toEqual([]);
  });
});

describe('diffItems', () => {
  it('detects unchanged, modified, added and removed', () => {
    const r = diffItems(
      [{ key: 'a', text: 'Users can log in.' }, { key: 'b', text: 'Lock the account after 3 failed attempts.' }, { key: 'c', text: 'Remember me is supported.' }],
      [{ key: 'x', text: 'Users can log in.' }, { key: 'y', text: 'Lock the account after 5 failed attempts.' }, { key: 'z', text: 'OTP is sent by SMS.' }],
    );
    expect(r.matches).toEqual([
      { oldKey: 'a', newKey: 'x', type: 'Unchanged', similarity: 1 },
      { oldKey: 'b', newKey: 'y', type: 'Modified', similarity: 0.86 },
    ]);
    expect(r.added).toEqual(['z']);
    expect(r.removed).toEqual(['c']);
  });
  it('similarity is symmetric-ish and bounded', () => {
    expect(similarity('a b c', 'a b c')).toBe(1);
    expect(similarity('a b c', 'x y z')).toBe(0);
  });
});
