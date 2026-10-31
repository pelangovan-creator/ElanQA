import { similarity } from '../requirements/analysis/diff';

export interface ItemLite { id: string; reqId: string; text: string; category: string; section?: string | null; page?: number | null }
export interface Finding { requirementId?: string; reqId?: string; question: string; category: 'Conflict' | 'MissingInfo' | 'EdgeCase' | 'Assumption'; priority: 'High' | 'Medium' | 'Low' }

const NUM = /\b\d+(?:[.,]\d+)?\b/g;
const NEG = /\b(must not|shall not|should not|cannot|can not|will not|won't|never|not allowed|prohibited|disabled)\b/i;

/**
 * Conflicts: two statements about the same thing (high word overlap) that disagree on a number
 * (e.g. "3 attempts" vs "5 attempts") or on polarity ("must" vs "must not").
 */
export function findConflicts(items: ItemLite[], threshold = 0.55): Finding[] {
  const out: Finding[] = [];
  const testable = items.filter((i) => !['Informational', 'OutOfScope'].includes(i.category) && i.text.split(/\s+/).length >= 4);
  for (let a = 0; a < testable.length; a++) {
    for (let b = a + 1; b < testable.length; b++) {
      const x = testable[a], y = testable[b];
      const s = similarity(x.text, y.text);
      if (s < threshold || s === 1) continue;
      const nx = (x.text.match(NUM) ?? []).sort().join('|');
      const ny = (y.text.match(NUM) ?? []).sort().join('|');
      const numberClash = nx && ny && nx !== ny;
      const polarityClash = NEG.test(x.text) !== NEG.test(y.text);
      if (!numberClash && !polarityClash) continue;
      out.push({
        requirementId: x.id, reqId: x.reqId, category: 'Conflict', priority: 'High',
        question: `${x.reqId} and ${y.reqId} appear to conflict: "${x.text}" vs "${y.text}". Which statement is correct?`,
      });
    }
  }
  return out;
}

interface GapRule { topic: RegExp; unless: RegExp; question: string; category: Finding['category']; priority: Finding['priority']; anchorCategory?: string }

/** Typical things clients forget to specify, checked against the whole requirement set. */
export const GAP_RULES: GapRule[] = [
  { topic: /\blog ?in\b|\bsign ?in\b/i, unless: /\b(attempts?|lock(ed|out)?)\b/i, category: 'MissingInfo', priority: 'High', question: 'How many failed login attempts lock an account, and for how long?' },
  { topic: /\block(ed|out)?\b/i, unless: /\b(unlock|reset|re-?enable|administrator unlocks|automatically unlocked)\b/i, category: 'MissingInfo', priority: 'High', question: 'How is a locked account unlocked (time-based, self-service reset, or administrator)?' },
  { topic: /\blog ?in\b|\bsign ?in\b/i, unless: /\bsession\b|\btime-?out\b|\binactiv/i, category: 'MissingInfo', priority: 'Medium', question: 'What is the session timeout after inactivity, and what happens to unsaved data?' },
  { topic: /\bpassword\b/i, unless: /\b(forgot|reset) password\b|\bpassword reset\b/i, category: 'MissingInfo', priority: 'Medium', question: 'Is a forgot/reset-password flow required? If so, how is the user verified and how long is the link valid?' },
  { topic: /\b(mandatory|required|valid|invalid|must be|characters|digits)\b/i, unless: /\berror messages?\b/i, category: 'MissingInfo', priority: 'High', anchorCategory: 'Validation', question: 'What exact error message should be shown for each validation failure (text, position, when it appears)?' },
  { topic: /./, unless: /\b(role|roles|admin|administrator|permission|privilege|manager|supervisor)\b/i, category: 'MissingInfo', priority: 'High', question: 'Which user roles exist and what is each role allowed to see and do?' },
  { topic: /\bupload/i, unless: /\b(mb|kb|gb|size|file types?|formats?|extensions?)\b/i, category: 'MissingInfo', priority: 'Medium', question: 'What file types and maximum file size are allowed for uploads, and what happens when they are exceeded?' },
  { topic: /\bsearch/i, unless: /\bno (results|matches)\b|\bempty result/i, category: 'EdgeCase', priority: 'Low', question: 'What should be displayed when a search returns no results, and are partial/case-insensitive matches expected?' },
  { topic: /\b(payment|pay|checkout|card)\b/i, unless: /\b(payments? (is |are |was )?(declin\w*|fail\w*|reject\w*)|declined (card|payment|transaction)|refund\w*|insufficient funds|payment time-?out)\b/i, category: 'EdgeCase', priority: 'High', question: 'What happens when a payment is declined, times out or fails after the order is created? Are refunds in scope?' },
  { topic: /\b(sms|otp|e-?mail notification|notif\w*|send an? e-?mail)\b/i, unless: /\b(retry|resend|not delivered|delivery fail\w*|bounce)\b/i, category: 'EdgeCase', priority: 'Medium', question: 'What happens if an SMS/e-mail/notification is not delivered? Can the user resend it, and how often?' },
  { topic: /\botp\b|one-time password/i, unless: /\b(expir\w*|valid for|minutes?)\b/i, category: 'MissingInfo', priority: 'High', question: 'How long is an OTP valid, how many digits does it have, and how many wrong attempts are allowed?' },
  { topic: /\bdates?\b/i, unless: /\b(dd|mm|yyyy|date format|iso ?8601|time ?zone)\b/i, category: 'MissingInfo', priority: 'Low', question: 'Which date format and time zone apply to entered and displayed dates?' },
  { topic: /\b(discount|tax|price|amount|total|rs\.?|inr|usd)\b/i, unless: /\bround\w*\b|\bdecimal/i, category: 'EdgeCase', priority: 'Medium', question: 'How are monetary amounts rounded (decimal places, rounding rule), and in which currency are they stored?' },
  { topic: /\b(delete|remove)\b/i, unless: /\b(confirm\w*|undo|soft[- ]delete|restore|recycle)\b/i, category: 'EdgeCase', priority: 'Medium', question: 'Does deleting require confirmation, and can deleted records be restored?' },
  { topic: /\b(browser|mobile|device)\b/i, unless: /\b(chrome|firefox|safari|edge|ios|android)\b.*\b(\d+|latest)\b/i, category: 'MissingInfo', priority: 'Medium', question: 'Which browsers, versions, devices and screen sizes must be supported?' },
];

export function findGaps(items: ItemLite[]): Finding[] {
  const all = items.map((i) => i.text).join('\n');
  const out: Finding[] = [];
  for (const r of GAP_RULES) {
    if (!r.topic.test(all) || r.unless.test(all)) continue;
    const matches = r.topic.source === '.' ? [] : items.filter((i) => r.topic.test(i.text) && i.category !== 'Informational');
    const anchor = matches.find((i) => r.anchorCategory && i.category === r.anchorCategory) ?? matches[0];
    out.push({ requirementId: anchor?.id, reqId: anchor?.reqId, question: anchor ? `${anchor.reqId}: ${r.question}` : r.question, category: r.category, priority: r.priority });
  }
  return out;
}
