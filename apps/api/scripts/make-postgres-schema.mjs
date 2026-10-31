// Generates prisma/schema.postgres.prisma from the SQLite dev schema (single source of truth).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma');
const src = readFileSync(join(dir, 'schema.prisma'), 'utf8');
const out = src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (out === src) throw new Error('sqlite provider line not found');
writeFileSync(join(dir, 'schema.postgres.prisma'), out);
console.log('wrote prisma/schema.postgres.prisma');
