import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * The code an authenticator app shows for the secret (RFC 6238: SHA-1, 6 digits, 30 seconds),
 * `offset` steps from now. The API accepts one step either side, each once.
 */
export function totp(secret: string, offset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const at = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}
