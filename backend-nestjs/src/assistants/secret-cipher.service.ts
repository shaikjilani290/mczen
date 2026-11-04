import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for provider API keys. The key comes only from
 * SECRET_MASTER_KEY (64 hex chars or 32-byte base64). A missing/invalid key
 * fails closed: secrets cannot be stored. Ciphertext is bound to its
 * tenant/assistant/kind through AAD so rows cannot be swapped between tenants.
 */
@Injectable()
export class SecretCipher {
  private key(): Buffer {
    const raw = process.env.SECRET_MASTER_KEY?.trim();
    let key: Buffer | undefined;
    if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
    else if (raw) {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) key = b;
    }
    if (!key) throw new ServiceUnavailableException('Secret storage is not configured.');
    return key;
  }

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  /** Server-side use only (future provider calls); never exposed through the API. */
  decrypt(payload: string, aad: string): string {
    const [version, iv, tag, ct] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !ct) throw new ServiceUnavailableException('Secret storage is not configured.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  }
}
