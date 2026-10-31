import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/** Fresh, throwaway SQLite DB (prisma/test.db) for every test run. */
export default function globalSetup() {
  for (const f of ['test.db', 'test.db-journal']) rmSync(join(__dirname, '..', 'prisma', f), { force: true });
  rmSync(join(__dirname, '..', 'test-storage'), { recursive: true, force: true });
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'ignore',
  });
}
