import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('opens what it sealed, which never shows the plaintext', () => {
    const sealed = box.seal('mail.smtp.password', 'päss wörd');

    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('päss');
    expect(box.open('mail.smtp.password', sealed)).toBe('päss wörd');
    expect(box.seal('mail.smtp.password', 'päss wörd')).not.toBe(sealed);
  });

  it('opens nothing sealed under another key or name, or altered', () => {
    const sealed = box.seal('mail.smtp.password', 'secret');
    const [version, iv, tag, ciphertext] = sealed.split('.');
    const flipped = Buffer.from(ciphertext!, 'base64url');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 1, 0);

    expect(new SecretBox(randomBytes(32)).open('mail.smtp.password', sealed)).toBeNull();
    expect(box.open('other.setting', sealed)).toBeNull();
    expect(
      box.open('mail.smtp.password', [version, iv, tag, flipped.toString('base64url')].join('.')),
    ).toBeNull();
    expect(
      box.open('mail.smtp.password', [version, iv, tag!.slice(0, 8), ciphertext].join('.')),
    ).toBeNull();
    expect(box.open('mail.smtp.password', 'secret')).toBeNull();
  });

  it('needs a 32-byte key', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
  });
});
