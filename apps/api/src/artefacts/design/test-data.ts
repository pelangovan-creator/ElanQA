/**
 * Synthetic test data. Never produces real personal data: e-mails use the reserved example.com
 * domain, phone numbers use the fictional +1-555-01xx range, cards use public test numbers.
 */
export interface FieldInfo { name: string; type: 'Email' | 'Password' | 'Card' | 'Phone' | 'Date' | 'Decimal' | 'Integer' | 'Name' | 'Text' | 'OTP' | 'Url' }

export interface DataDraft {
  key: string; // stable within one generation run, e.g. REQ id
  itemId?: string;
  fieldName: string;
  dataType: string;
  validValues: string[];
  invalidValues: string[];
  boundaryValues?: { minMinus1?: string; min?: string; minPlus1?: string; maxMinus1?: string; max?: string; maxPlus1?: string };
  specialChars: string;
  emptyNull: string;
  expectedBehaviour: string;
  notes?: string;
}

const FIELD_PATTERNS: [RegExp, FieldInfo['type'], string][] = [
  [/\be-?mail\b/i, 'Email', 'Email'],
  [/\bpassword|passcode|pin\b/i, 'Password', 'Password'],
  [/\b(card number|credit card|debit card|card)\b/i, 'Card', 'Card number'],
  [/\b(phone|mobile|contact number)\b/i, 'Phone', 'Phone number'],
  [/\botp\b|one-time password/i, 'OTP', 'OTP'],
  [/\b(date|dob|birth)\b/i, 'Date', 'Date'],
  [/\b(amount|price|total|order value|rs\.?|inr|usd|discount)\b/i, 'Decimal', 'Amount'],
  [/\b(quantity|qty|count|age)\b/i, 'Integer', 'Quantity'],
  [/\b(url|website|link)\b/i, 'Url', 'URL'],
  [/\b(first name|last name|full name|name)\b/i, 'Name', 'Name'],
];

export function detectField(text: string, subject?: string): FieldInfo {
  const hay = `${subject ?? ''} ${text}`;
  for (const [re, type, name] of FIELD_PATTERNS) if (re.test(subject ?? '') || (!subject && re.test(hay))) return { type, name: subject && re.test(subject) ? subject : name };
  for (const [re, type, name] of FIELD_PATTERNS) if (re.test(hay)) return { type, name };
  // Fall back to the grammatical subject: words before "must/shall/should/is".
  const subj = /^(?:the\s+)?([\w\s-]{2,40}?)\s+(?:must|shall|should|is|are|will|can)\b/i.exec(text)?.[1];
  return { type: /\bdigits?|numeric|number\b/i.test(text) ? 'Integer' : 'Text', name: subject ?? (subj ? subj.replace(/^\w/, (c) => c.toUpperCase()) : 'Input field') };
}

/** Password-like string of exact length containing upper, lower, digit and symbol. */
export function passwordOfLength(n: number): string {
  if (n <= 0) return '';
  const base = 'Aa1!';
  let s = '';
  while (s.length < n) s += base[s.length % 4] === 'A' ? String.fromCharCode(65 + (s.length % 26)) : base[s.length % 4];
  return s.slice(0, n);
}
const textOfLength = (n: number) => (n <= 0 ? '' : 'abcdefghijklmnopqrstuvwxyz'.repeat(Math.ceil(n / 26)).slice(0, n));
const digitsOfLength = (n: number) => (n <= 0 ? '' : '4111111111111111111111111111111111'.slice(0, n));
const label = (v: string, n: number, unit = 'chars') => `${v} (${n} ${unit})`;

export function syntheticData(field: FieldInfo, nums: { min?: number; max?: number; unit?: string; threshold?: number; thresholdDir?: string }, item: { id: string; reqId: string; text: string }): DataDraft {
  const d: DataDraft = {
    key: item.reqId, itemId: item.id, fieldName: field.name, dataType: field.type, validValues: [], invalidValues: [],
    specialChars: `<script>alert(1)</script> ; ' OR '1'='1 ; Ünïcødé ✓ ; 𝔘𝔫𝔦𝔠𝔬𝔡𝔢`, emptyNull: '"" (empty), "   " (spaces only), null/omitted',
    expectedBehaviour: `Valid values accepted; invalid, empty and out-of-range values rejected with a clear message (${item.reqId}: ${item.text})`,
  };
  const lenUnit = /digit/i.test(nums.unit ?? '') ? 'digits' : 'chars';
  const make = field.type === 'Password' ? passwordOfLength : lenUnit === 'digits' || field.type === 'Card' || field.type === 'Integer' ? digitsOfLength : textOfLength;

  switch (field.type) {
    case 'Email':
      d.validValues = ['qa.user01@example.com', 'first.last+tag@example.co.uk', 'a@example.com'];
      d.invalidValues = ['plainaddress', 'user@', '@example.com', 'user@@example.com', 'user@example', 'user name@example.com'];
      break;
    case 'Password':
      d.validValues = [passwordOfLength(Math.max(nums.min ?? 8, Math.min(nums.max ?? 12, 12)))];
      // Invalid classes follow what THIS requirement states - a generic password policy would create false failures.
      d.invalidValues = [
        ...(/\b(digit|number|numeric)/i.test(item.text) ? ['Password!x (no digit)'] : []),
        ...(/\bupper/i.test(item.text) ? ['password1! (no upper case)'] : []),
        ...(/\blower/i.test(item.text) ? ['PASSWORD1! (no lower case)'] : []),
        ...(/\b(special|symbol)/i.test(item.text) ? ['Password12 (no symbol)'] : []),
        ...(nums.min !== undefined ? [`${passwordOfLength(nums.min - 1)} (too short)`] : []),
        ...(nums.max !== undefined ? [`${passwordOfLength(nums.max + 1)} (too long)`] : []),
      ];
      if (!d.invalidValues.length) d.invalidValues = ['a1! (too short / weak - confirm the policy)'];
      break;
    case 'Card':
      d.validValues = ['4111111111111111 (Visa test card)', '5555555555554444 (Mastercard test card)'];
      d.invalidValues = ['411111111111111 (15 digits)', '41111111111111111 (17 digits)', '411111111111111a (letters)', ...(/\b(luhn|valid)\b/i.test(item.text) ? ['4111111111111112 (fails Luhn)'] : [])];
      d.notes = 'Public test card numbers only - never use real cards.';
      break;
    case 'Phone':
      d.validValues = ['+15555550100', '+15555550199'];
      d.invalidValues = ['12345', '+1555555010000000', 'phone-number', '+1 (555) ABC'];
      d.notes = '555-01xx numbers are reserved for fiction.';
      break;
    case 'OTP':
      d.validValues = ['123456 (as received in the test inbox/SMS stub)'];
      d.invalidValues = ['000000 (wrong code)', '12345 (too short)', '1234567 (too long)', 'abcdef', 'expired code'];
      break;
    case 'Date':
      d.validValues = ['2026-01-31', '2028-02-29 (leap day)', '2026-12-31'];
      d.invalidValues = ['2026-02-30', '31/31/2026', '2026-13-01', 'tomorrow'];
      break;
    case 'Decimal':
      d.validValues = ['1.00', '999.99'];
      d.invalidValues = ['-1', 'abc', '1.999 (3 decimals)', '1e9'];
      break;
    case 'Integer':
      d.validValues = ['1', '10'];
      d.invalidValues = ['-1', '1.5', 'ten', ''];
      break;
    case 'Url':
      d.validValues = ['https://example.com', 'https://example.com/path?q=1'];
      d.invalidValues = ['example', 'htp://bad', 'javascript:alert(1)'];
      break;
    case 'Name':
      d.validValues = ['Test User', 'José Ñúñez', "O'Brien-Smith"];
      d.invalidValues = ['1234', '<b>Name</b>', textOfLength(256)];
      break;
    default:
      d.validValues = ['Sample value'];
      d.invalidValues = ['(value violating the rule)'];
  }

  if (nums.threshold !== undefined) {
    const t = nums.threshold;
    d.boundaryValues = { minMinus1: String(t - 1), min: String(t), minPlus1: String(t + 1) };
    d.validValues = [String(nums.thresholdDir === 'below' ? t - 1 : t + 1), String(nums.thresholdDir === 'below' ? Math.max(0, t - 100) : t + 100)];
    d.invalidValues = [String(t), '0', '-1', 'abc'];
    d.dataType = 'Decimal';
  } else if (nums.min !== undefined || nums.max !== undefined) {
    const b: DataDraft['boundaryValues'] = {};
    if (nums.min !== undefined) {
      b.minMinus1 = label(make(nums.min - 1), nums.min - 1, lenUnit);
      b.min = label(make(nums.min), nums.min, lenUnit);
      b.minPlus1 = label(make(nums.min + 1), nums.min + 1, lenUnit);
    }
    if (nums.max !== undefined) {
      b.maxMinus1 = label(make(nums.max - 1), nums.max - 1, lenUnit);
      b.max = label(make(nums.max), nums.max, lenUnit);
      b.maxPlus1 = label(make(nums.max + 1), nums.max + 1, lenUnit);
    }
    d.boundaryValues = b;
  }
  return d;
}

/** One synthetic test account per application role. Passwords are never generated or stored here. */
export function roleAccounts(roles: string[]): DataDraft[] {
  return roles.map((r) => ({
    key: `ACC-${r}`, fieldName: `Test account – ${r}`, dataType: 'Account',
    validValues: [`qapilot.${r.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`], invalidValues: ['disabled/locked account', 'unknown user'],
    specialChars: '', emptyNull: 'Empty username/password must be rejected',
    expectedBehaviour: `Signs in with the permissions of the ${r} role only`,
    notes: 'Create this account in the application under test. Store its password in the encrypted environment credentials (Test Execution settings), not here.',
  }));
}
