import * as bcrypt from 'bcryptjs';

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** Min 8 chars with upper, lower, digit and symbol. */
export function passwordPolicyError(p: string): string | null {
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    return 'Password must contain upper case, lower case, a digit and a symbol';
  }
  return null;
}
