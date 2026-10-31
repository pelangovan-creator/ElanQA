import { designForItem, endToEnd, extractNumbers, moduleName, DesignItem } from './generator';
import { detectField, passwordOfLength, roleAccounts } from './test-data';

let n = 0;
const seq = () => `S${++n}`;
const item = (text: string, category: string, extra: Partial<DesignItem> = {}): DesignItem => ({ id: `id-${text.length}`, reqId: 'REQ-001.01', text, category, sourceKind: 'Sentence', module: 'Login', ...extra });

describe('extractNumbers', () => {
  it.each([
    ['Password must be 8 to 16 characters long', { min: 8, max: 16, unit: 'characters' }],
    ['Card number must be 16 digits', { min: 16, max: 16, unit: 'digits' }],
    ['Orders above Rs. 5000 receive a 10% discount.', { threshold: 5000, thresholdDir: 'above' }],
    ['The account must be locked after 3 consecutive failed login attempts.', { attempts: 3 }],
    ['Search results load within 2 seconds', { seconds: 2 }],
    ['Name must be at least 2 characters', { min: 2 }],
  ])('%s', (t, expected) => expect(extractNumbers(t)).toMatchObject(expected));
});

describe('designForItem', () => {
  it('validation with a range → EP valid/invalid + BVA valid/invalid + test data with boundaries', () => {
    const out = designForItem(item('Password must be 8 to 16 characters long', 'Validation'), seq);
    expect(out.cases.map((c) => c.technique)).toEqual(['EquivalencePartitioning', 'EquivalencePartitioning', 'BoundaryValueAnalysis', 'BoundaryValueAnalysis']);
    expect(out.scenarios.map((s) => s.scenarioType)).toEqual(['Positive', 'Negative', 'Edge']);
    expect(out.data[0].boundaryValues).toMatchObject({ minMinus1: expect.stringContaining('(7 chars)'), max: expect.stringContaining('(16 chars)'), maxPlus1: expect.stringContaining('(17 chars)') });
    expect(out.cases.every((c) => c.dataKey === 'REQ-001.01' && c.itemIds.length === 1)).toBe(true);
  });

  it('business rule with threshold → BVA around the threshold', () => {
    const out = designForItem(item('Orders above Rs. 5000 receive a 10% discount.', 'BusinessRule', { module: 'Checkout' }), seq);
    expect(out.cases[0].title).toContain('5001');
    expect(out.cases[1].steps[1].action).toContain('5000');
    expect(out.data[0].boundaryValues).toEqual({ minMinus1: '4999', min: '5000', minPlus1: '5001' });
  });

  it('lockout after N attempts → state transition at N-1 and N', () => {
    const out = designForItem(item('The account must be locked after 3 consecutive failed login attempts.', 'Functional'), seq);
    const st = out.cases.find((c) => c.technique === 'StateTransition')!;
    expect(st.steps[1].action).toContain('2 consecutive');
    expect(out.cases.map((c) => c.technique)).toEqual(['StateTransition', 'UseCase', 'ErrorGuessing']);
    expect(out.cases[1].suites).toContain('Smoke');
  });

  it('non-functional sub-categories map to the right test types', () => {
    const types = (sub: string) => designForItem(item('x shall y', 'NonFunctional', { subCategory: sub }), seq).cases.map((c) => `${c.testType}/${c.technique}`);
    expect(types('performance')).toEqual(['Load/BoundaryValueAnalysis', 'Stress/ErrorGuessing']);
    expect(types('compatibility')).toEqual(['Compatibility/Pairwise']);
    expect(types('accessibility')).toEqual(['Accessibility/ChecklistBased']);
    expect(types('usability')).toEqual(['Usability/Exploratory']);
  });

  it('carries ambiguity and open questions into comments', () => {
    const out = designForItem(item('The login page should load fast.', 'NonFunctional', { subCategory: 'performance', ambiguousTerms: ['should', 'fast/quick'], openQuestions: ['Q-002'] }), seq);
    expect(out.cases[0].comments).toContain('Q-002');
    expect(out.cases[0].comments).toContain('fast/quick');
  });

  it('end-to-end scenario chains modules', () => {
    const a = designForItem(item('Users can log in.', 'Functional', { id: 'a' }), seq);
    const b = designForItem(item('Users can pay.', 'Functional', { id: 'b', module: 'Checkout' }), seq);
    const e2e = endToEnd([...a.cases, ...b.cases], [], seq);
    expect(e2e.cases[0]).toMatchObject({ testType: 'EndToEnd', title: 'End-to-end: Login → Checkout', itemIds: ['a', 'b'] });
  });
});

describe('helpers', () => {
  it('moduleName strips numbering', () => {
    expect(moduleName('2 Login', 'Doc')).toBe('Login');
    expect(moduleName('3.1.2 Payment Options › Rule', 'Doc')).toBe('Payment Options');
    expect(moduleName(null, 'Doc')).toBe('Doc');
  });
  it('detectField', () => {
    expect(detectField('Password must be 8 to 16 characters long').type).toBe('Password');
    expect(detectField('Mandatory, valid email format', 'Email')).toEqual({ type: 'Email', name: 'Email' });
    expect(detectField('16 digits, Luhn check', 'Card number')).toEqual({ type: 'Card', name: 'Card number' });
  });
  it('passwordOfLength has exact length and mixed classes', () => {
    const p = passwordOfLength(8);
    expect(p).toHaveLength(8);
    expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/\d/); expect(p).toMatch(/[^A-Za-z0-9]/);
  });
  it('role accounts use example.com and contain no password', () => {
    const acc = roleAccounts(['QA Lead']);
    expect(acc[0].validValues[0]).toBe('qapilot.qa.lead@example.com');
    expect(JSON.stringify(acc)).not.toMatch(/password\s*[:=]/i);
  });
});
