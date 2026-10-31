/** Vague / weak words that must be turned into clarification questions. */
export const AMBIGUOUS_TERMS: { term: string; re: RegExp; question: (q: string) => string }[] = [
  { term: 'should', re: /\bshould\b/i, question: (r) => `${r} uses "should". Is this mandatory (must) or optional? What happens if it is not met?` },
  { term: 'may', re: /\bmay\b/i, question: (r) => `${r} uses "may". Under which conditions does this apply, and is it in scope for testing?` },
  { term: 'might/could', re: /\b(might|could)\b/i, question: (r) => `${r} uses "might/could". Please confirm whether this is a requirement and when it applies.` },
  { term: 'fast/quick', re: /\b(fast|faster|quick(ly)?|rapid(ly)?|instant(ly)?|speedy|responsive|real[- ]time)\b/i, question: (r) => `${r} has a non-measurable speed term. What is the target (e.g. response time in seconds, at what concurrent load, on which network)?` },
  { term: 'user-friendly', re: /\b(user[- ]friendly|intuitive|easy to use|easy|simple|simply|seamless(ly)?|smooth(ly)?|clean|modern|attractive|nice|good)\b/i, question: (r) => `${r} uses a subjective quality term. What objective acceptance criteria apply (e.g. task completion steps, WCAG level, style guide)?` },
  { term: 'etc.', re: /\b(etc\.?|and so on|and\/or|among others|such as)\b/i, question: (r) => `${r} contains an open-ended list ("etc."/"such as"/"and/or"). Please list every item that must be supported.` },
  { term: 'approximately', re: /\b(approx(\.|imately)?|about|around|roughly|nearly|almost|~)\b/i, question: (r) => `${r} gives an approximate value. What is the exact value or acceptable tolerance?` },
  { term: 'as needed', re: /\b(as needed|as required|as appropriate|if needed|if required|where (applicable|appropriate|possible)|if possible|when necessary|as necessary)\b/i, question: (r) => `${r} says "as needed/where applicable". Who decides, and what are the exact conditions?` },
  { term: 'TBD', re: /\b(tbd|tbc|tba|to be (decided|determined|confirmed|defined|discussed)|pending|later|\?\?+)\b/i, question: (r) => `${r} contains an unresolved placeholder (TBD/TBC). Please provide the final value/behaviour.` },
  { term: 'adequate', re: /\b(adequate|sufficient|enough|reasonable|appropriate|acceptable|suitable|proper(ly)?|optimal|efficient(ly)?|robust|flexible|scalable|minimal|maximi[sz]e|minimi[sz]e)\b/i, question: (r) => `${r} uses an unmeasurable term (adequate/robust/efficient...). What is the measurable acceptance criterion?` },
  { term: 'some/several', re: /\b(some|several|many|few|various|multiple|numerous|a number of|most|majority)\b/i, question: (r) => `${r} uses an unspecified quantity. What is the exact number or range (min/max)?` },
  { term: 'normally', re: /\b(normally|usually|generally|typically|often|sometimes|rarely|mostly|in most cases)\b/i, question: (r) => `${r} says "normally/usually". What is the expected behaviour in the exceptional case?` },
  { term: 'support', re: /\bsupport(s|ed)?\b(?! (team|desk|staff|ticket))/i, question: (r) => `${r} says "support". What exactly must the system do (functions, formats, versions) to count as supporting it?` },
];

export function findAmbiguities(text: string): string[] {
  return AMBIGUOUS_TERMS.filter((t) => t.re.test(text)).map((t) => t.term);
}

export function questionFor(term: string, reqId: string): string {
  const t = AMBIGUOUS_TERMS.find((a) => a.term === term);
  return t ? t.question(reqId) : `${reqId} contains the ambiguous term "${term}". Please clarify.`;
}
