/** Fail fast on missing/unsafe configuration. Nothing secret is hard-coded. */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  if (!env.DATABASE_URL) errors.push('DATABASE_URL is required');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET.startsWith('change-me')) {
    errors.push('JWT_SECRET must be set to a random string of at least 32 characters');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY ?? '')) errors.push('ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
  if (errors.length) throw new Error(`Invalid configuration:\n - ${errors.join('\n - ')}`);
}
