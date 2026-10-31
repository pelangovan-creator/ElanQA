import { CryptoService } from './crypto.service';
import { roleHas } from './permissions';
import { redact } from '../audit/audit.service';
import { passwordPolicyError } from '../auth/password';
import { validateEnv } from '../config';

describe('CryptoService', () => {
  const crypto = new CryptoService();
  it('round-trips and uses a random IV', () => {
    const a = crypto.encrypt('jira-token-123');
    const b = crypto.encrypt('jira-token-123');
    expect(a).not.toEqual(b);
    expect(a).not.toContain('jira-token');
    expect(crypto.decrypt(a)).toBe('jira-token-123');
  });
  it('rejects tampered ciphertext', () => {
    const parts = crypto.encrypt('secret').split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });
  it('masks secrets', () => {
    expect(CryptoService.mask('abcdefgh')).toBe('****efgh');
    expect(CryptoService.mask('ab')).toBe('****');
  });
});

describe('permissions', () => {
  it('Admin has everything', () => expect(roleHas('Admin', 'users.manage')).toBe(true));
  it('Client is view-only', () => {
    expect(roleHas('Client', 'project.view')).toBe(true);
    expect(roleHas('Client', 'artefacts.edit')).toBe(false);
    expect(roleHas('Client', 'defects.update')).toBe(false);
  });
  it('Developer can update defects but not review artefacts', () => {
    expect(roleHas('Developer', 'defects.update')).toBe(true);
    expect(roleHas('Developer', 'artefacts.review')).toBe(false);
  });
  it('only QA Lead/Admin acknowledge coverage gaps', () => {
    expect(roleHas('QALead', 'coverage.acknowledge')).toBe(true);
    expect(roleHas('Tester', 'coverage.acknowledge')).toBe(false);
  });
});

describe('audit redaction', () => {
  it('redacts secret-looking keys recursively', () => {
    expect(redact({ name: 'x', passwordHash: 'h', nested: { apiToken: 't', ok: 1 }, list: [{ secret: 's' }] })).toEqual({
      name: 'x', passwordHash: '[REDACTED]', nested: { apiToken: '[REDACTED]', ok: 1 }, list: [{ secret: '[REDACTED]' }],
    });
  });
});

describe('password policy', () => {
  it.each([['short1!A', null], ['alllower1!', 'Password must contain upper case, lower case, a digit and a symbol'], ['Ab1!', 'Password must be at least 8 characters']])(
    '%s', (pw, expected) => expect(passwordPolicyError(pw)).toBe(expected),
  );
});

describe('validateEnv', () => {
  it('rejects placeholder secrets', () => {
    expect(() => validateEnv({ DATABASE_URL: 'file:x', JWT_SECRET: 'change-me-to-a-long-random-string', ENCRYPTION_KEY: '' })).toThrow(/JWT_SECRET[\s\S]*ENCRYPTION_KEY/);
  });
  it('accepts valid config', () => {
    expect(() => validateEnv({ DATABASE_URL: 'file:x', JWT_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: 'a'.repeat(64) })).not.toThrow();
  });
  it('requires PostgreSQL and explicit CORS origins in production', () => {
    const ok = { JWT_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: 'a'.repeat(64), NODE_ENV: 'production' };
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'file:./dev.db' })).toThrow(/PostgreSQL/);
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'postgresql://u:p@db/q', CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'postgresql://u:p@db/q', CORS_ORIGIN: 'https://qa.example.com' })).not.toThrow();
  });
});
