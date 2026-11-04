import { ServiceUnavailableException } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedToolSecret {
  keyVersion: number;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** AES-256-GCM tool secret envelope, bound to tenant/tool/key/version. */
@Injectable()
export class ToolSecretCipher {
  private key(): Buffer {
    const raw = process.env.SECRET_MASTER_KEY?.trim();
    let key: Buffer | undefined;
    if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
    else if (raw) {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) key = decoded;
    }
    if (!key) throw new ServiceUnavailableException('Tool secret storage is not configured.');
    return key;
  }

  currentVersion(): number {
    const version = Number(process.env.SECRET_MASTER_KEY_VERSION ?? '1');
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new ServiceUnavailableException('Tool secret storage is not configured.');
    }
    return version;
  }

  encrypt(plain: string, aad: string): EncryptedToolSecret {
    const keyVersion = this.currentVersion();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { keyVersion, ciphertext, iv, authTag: cipher.getAuthTag() };
  }

  decrypt(value: EncryptedToolSecret, aad: string): string {
    if (value.keyVersion !== this.currentVersion()) {
      throw new ServiceUnavailableException('Tool secret key version is unavailable.');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(), value.iv);
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(value.authTag);
      return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException('Tool secret could not be decrypted.');
    }
  }
}
