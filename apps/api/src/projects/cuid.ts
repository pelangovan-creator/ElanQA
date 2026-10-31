import { randomBytes } from 'node:crypto';

/**
 * Collision-resistant ids in the same shape as Prisma's cuid() ('c' + 24 lowercase
 * alphanumerics), so restored rows look like any other row and can be backed up again.
 */
let counter = randomBytes(2).readUInt16BE(0);
const fingerprint = (process.pid.toString(36) + randomBytes(2).toString('hex')).slice(-4).padStart(4, '0');
const rand = (n: number) => {
  let s = '';
  while (s.length < n) s += randomBytes(8).readBigUInt64BE().toString(36);
  return s.slice(0, n);
};

export function createId(): string {
  counter = (counter + 1) % 36 ** 4;
  return `c${Date.now().toString(36).padStart(8, '0').slice(-8)}${counter.toString(36).padStart(4, '0')}${fingerprint}${rand(8)}`;
}
