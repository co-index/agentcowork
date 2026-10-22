import { createHash, randomBytes } from 'node:crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** URL-safe random string of `length` base32 characters. */
export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += BASE32[b & 31];
  return out;
}

export function newId(prefix: 'r' | 'p' | 'm'): string {
  return `${prefix}_${randomToken(12)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
