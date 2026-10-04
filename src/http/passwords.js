import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
// OWASP's scrypt alternative uses 32 MiB per operation instead of 128 MiB.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded || '');
  const salt = match?.[1] || '0'.repeat(32);
  const expected = Buffer.from(match?.[2] || '0'.repeat(128), 'hex');
  const actual = await derive(password, salt, 64, options);
  return timingSafeEqual(actual, expected) && Boolean(match);
}
