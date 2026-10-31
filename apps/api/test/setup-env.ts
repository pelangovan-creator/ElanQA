// Isolated SQLite DB + deterministic secrets for tests.
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1';
process.env.NODE_ENV = 'test';
process.env.STORAGE_DIR = './test-storage';
delete process.env.ANTHROPIC_API_KEY; // tests exercise the deterministic rule-based path
