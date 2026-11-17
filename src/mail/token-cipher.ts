import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM for refresh tokens at rest. Format: v1:<iv>:<tag>:<ciphertext>, base64. */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32)
      throw new Error('MAIL_TOKEN_KEY must be 32 bytes, base64-encoded');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
      .join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, ct] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ct)
      throw new Error('Unrecognized encrypted token format');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
