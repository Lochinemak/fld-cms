import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const TAG_LENGTH = 16;

/**
 * Encrypts the secrets kept in the database (the SMTP password) with AES-256-GCM, under
 * `SETTINGS_ENCRYPTION_KEY`: a database dump or backup alone does not reveal them. Each value is
 * bound to its setting's name, so a sealed value moved to another setting does not open.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('The settings encryption key must be 32 bytes');
    }
  }

  seal(name: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(Buffer.from(name, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  /** The plaintext, or null for a value sealed under another key or name, or altered. */
  open(name: string, sealed: string): string | null {
    const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
      return null;
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), {
        authTagLength: TAG_LENGTH,
      });
      decipher.setAAD(Buffer.from(name, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
