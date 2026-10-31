import { cleanError } from './defects.service';
import { defaultPriority, defectTypeFor, isOpen, LIFECYCLE } from './lifecycle';

describe('cleanError', () => {
  it('rewrites Playwright text assertions into a sentence', () => {
    const raw = 'Error: expect(locator).toContainText(expected) failed\n\nLocator: locator(\'body\')\nTimeout: 5000ms\nExpected pattern: /locked/i\nReceived string:  "ShopEasy\\nLogin\\nInvalid email or password."\n\nCall log:\n  - waiting';
    expect(cleanError(raw)).toBe('Expected the page to show text matching /locked/i - it showed: "ShopEasy Login Invalid email or password."');
  });
  it('handles negated assertions', () => {
    expect(cleanError('Error: expect(locator).not.toContainText(expected) failed\nExpected pattern: /invalid/i\nReceived string: "Invalid"')).toMatch(/^Expected the page NOT to show/);
  });
  it('keeps our own assertion messages, dropping the Expected/Received noise', () => {
    expect(cleanError('Error: "Password" should be rejected with a validation error\n\nexpect(received).toBe(expected)\n\nExpected: true\nReceived: false')).toBe('"Password" should be rejected with a validation error');
  });
  it('summarises timeouts', () => {
    expect(cleanError('TimeoutError: locator.fill: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByLabel(/Email/i)')).toBe('TimeoutError: locator.fill: Timeout 10000ms exceeded. (waiting for getByLabel(/Email/i))');
  });
});

describe('defect rules', () => {
  it('priority from severity and test priority', () => {
    expect(defaultPriority('Blocker')).toBe('P1');
    expect(defaultPriority('Critical', 'High')).toBe('P1');
    expect(defaultPriority('Critical', 'Medium')).toBe('P2');
    expect(defaultPriority('Trivial')).toBe('P4');
  });
  it('defect type from test type / requirement', () => {
    expect(defectTypeFor('Security')).toBe('Security');
    expect(defectTypeFor('Load')).toBe('Performance');
    expect(defectTypeFor('Functional', 'UIUX')).toBe('UI');
    expect(defectTypeFor('Negative')).toBe('Functional');
  });
  it('life cycle covers every status and open/closed is consistent', () => {
    for (const targets of Object.values(LIFECYCLE)) for (const t of targets) expect(LIFECYCLE[t]).toBeDefined();
    expect(isOpen('Reopened')).toBe(true);
    expect(isOpen('Closed')).toBe(false);
    expect(isOpen('Verified')).toBe(false);
  });
});
