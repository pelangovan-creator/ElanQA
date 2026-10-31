export const NFR_RULES: [string, RegExp][] = [
  ['performance', /\b(response time|within \d+(\.\d+)?\s*(ms|milliseconds?|seconds?|secs?|minutes?)|load time|latency|throughput|concurrent|requests per|tps|load|stress|scal(e|able|ability)|performance|fast|quick(ly)?|speed)\b/i],
  ['security', /\b(encrypt\w*|2fa|mfa|multi-factor|session time-?out|owasp|captcha|ssl|tls|https|xss|sql injection|csrf|brute[- ]force|access control|role-based access|pii|gdpr|masked|hash(ed|ing)?|secure(ly)?|security|vulnerabilit\w*|penetration)\b/i],
  ['accessibility', /\b(wcag|accessib\w*|screen reader|keyboard(-only)? navigation|aria|contrast|alt text|assistive)\b/i],
  ['compatibility', /\b(browser|chrome|firefox|safari|edge|ios|android|mobile|tablet|desktop|device|responsive|resolution|operating system|windows|macos)\b/i],
  ['localization', /\b(locali[sz]\w*|language|translation|multi-?lingual|currency|time ?zone|date format|i18n|l10n|rtl|hindi|arabic)\b/i],
  ['usability', /\b(user[- ]friendly|intuitive|easy to use|ease of use|usability|consistent look|clutter|learnab\w*)\b/i],
  ['reliability', /\b(uptime|availability|99\.\d+%|backup|recover\w*|failover|disaster|retry|fault toleran\w*|downtime)\b/i],
];

const RULES: [string, RegExp][] = [
  ['OutOfScope', /\b(out of scope|not in scope|outside (the )?scope|excluded|will not be (delivered|developed|supported|tested|covered|part)|is not required|not part of (this|the) (release|phase|project))\b/i],
  ['Assumption', /\b(assum(e|es|ed|ing|ption|ptions)|it is expected that|presum\w*)\b/i],
  ['Constraint', /\b(constraint|must comply|complian\w*|regulat\w*|limited to|restricted to|only (be )?available (on|in)|deadline|budget|must use|technology stack|licen[cs]e)\b/i],
  ['Validation', /(\b\d+\s*(?:-|–|to)\s*\d+\b)|\b(mandatory|required field|is required|must be (a )?valid|invalid|valid (email|phone|format|date)|format|characters?|digits?|alphanumeric|numeric|min(imum)?|max(imum)?|length|between \d+ and \d+|at least \d+|no more than|error message|validation|validate[sd]?|reject\w*|not (be )?(blank|empty)|unique|duplicate)\b/i],
  ['Integration', /\b(api|apis|integrat\w*|third[- ]party|gateway|webhook|sms|email service|erp|crm|sap|salesforce|sync\w*|interface with|external system|rest|soap|feed|import from|export to)\b/i],
  ['BusinessRule', /\b(if .+ then|eligib\w*|discount|calculat\w*|commission|interest rate|fees?|charges?|pric(e|es|ing)|tax|gst|vat|approval|approve[sd]?|workflow|policy|rule|threshold|limit of|per day|per transaction|percentage|\d+\s?%)\b/i],
  ['Data', /\b(stored|storage|stores? (?:the|all|each|every|data|records?|in|for)|database|retain\w*|retention|record(s|ed)?|archiv\w*|data (model|field|migration)|report(s|ing)?|export\w*|import\w*|audit trail|logs|logging|logged(?! in)|history)\b/i],
  ['UIUX', /\b(button|screen|page|display(s|ed)?|shown|show|colou?r|layout|click|tap|dropdown|drop-down|icon|menu|tab|modal|pop-?up|tooltip|label|font|banner|link|form|field|grid|dashboard|navigat\w*)\b/i],
  ['Functional', /\b(shall|must|should|will|can|may|allow(s|ed)?|enabl(e|es)|able to|provide[sd]?|support[sd]?|user(s)? (can|shall|must|should|will)|system (shall|must|should|will)|feature|function\w*|create|update|delete|search|login|log in|register|submit|send|generate|notify|upload|download)\b/i],
];

export interface Classification {
  category: string;
  subCategory?: string;
}

/**
 * Deterministic rule-based classification (used when no AI key is configured, and as the
 * baseline the AI result is validated against). Headers/table headers are Informational.
 */
export function classify(text: string, sourceKind: string, isTableHeader = false): Classification {
  if (sourceKind === 'Header' || isTableHeader) return { category: 'Informational' };
  // Captions label figures/tables; they only carry a requirement when they contain a modal verb.
  if (sourceKind === 'Caption' && !/\b(shall|must|should|will)\b/i.test(text)) return { category: 'Informational' };
  // Non-functional first: measurable quality attributes.
  for (const [sub, re] of NFR_RULES) {
    if (re.test(text) && !/\b(out of scope|assum\w*)\b/i.test(text)) {
      // A UI statement mentioning a "page" is not performance; require a quality signal for perf.
      if (sub === 'performance' && !/\b(\d+(\.\d+)?\s*(ms|milliseconds?|seconds?|secs?|minutes?)|concurrent|load|latency|throughput|performance|fast|quick|speed|response time|scal)/i.test(text)) continue;
      return { category: 'NonFunctional', subCategory: sub };
    }
  }
  for (const [cat, re] of RULES) if (re.test(text)) return { category: cat };
  return { category: 'Informational' };
}
