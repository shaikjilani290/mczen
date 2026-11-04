import { ServiceUnavailableException } from '@nestjs/common';
import { ToolSecretCipher, EncryptedToolSecret } from './tool-secret-cipher';

describe('ToolSecretCipher', () => {
  const previousKey = process.env.SECRET_MASTER_KEY;
  const previousVersion = process.env.SECRET_MASTER_KEY_VERSION;
  const cipher = new ToolSecretCipher();

  beforeEach(() => {
    process.env.SECRET_MASTER_KEY = '11'.repeat(32);
    process.env.SECRET_MASTER_KEY_VERSION = '7';
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.SECRET_MASTER_KEY;
    else process.env.SECRET_MASTER_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.SECRET_MASTER_KEY_VERSION;
    else process.env.SECRET_MASTER_KEY_VERSION = previousVersion;
  });

  it('round-trips an encrypted secret bound to its AAD', () => {
    const aad = 'tenant/tool/credential/7';
    const encrypted = cipher.encrypt('private-value', aad);
    expect(encrypted.keyVersion).toBe(7);
    expect(cipher.decrypt(encrypted, aad)).toBe('private-value');
    expect(encrypted.ciphertext.toString()).not.toContain('private-value');
  });

  it('defaults to key version 1 when unset, keeping version-1 secrets decryptable', () => {
    delete process.env.SECRET_MASTER_KEY_VERSION;
    const encrypted = cipher.encrypt('private-value', 'bound');
    expect(encrypted.keyVersion).toBe(1);
    expect(cipher.decrypt(encrypted, 'bound')).toBe('private-value');
    process.env.SECRET_MASTER_KEY_VERSION = '1';
    expect(cipher.decrypt(encrypted, 'bound')).toBe('private-value');
  });

  it.each(['', '0', '-1', 'abc', '1.5'])('refuses to operate with invalid key version %j', (value) => {
    process.env.SECRET_MASTER_KEY_VERSION = value;
    expect(() => cipher.encrypt('x', 'bound')).toThrow(ServiceUnavailableException);
  });

  it('rejects a secret encrypted with an unavailable key version', () => {
    const encrypted = cipher.encrypt('private-value', 'bound');
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 6 }, 'bound'))
      .toThrow(ServiceUnavailableException);
  });

  it('rejects ciphertext tampering and tenant/key swaps', () => {
    const encrypted = cipher.encrypt('private-value', 'tenant-a/tool-a/key/7');
    const corrupted: EncryptedToolSecret = {
      ...encrypted,
      ciphertext: Buffer.from(encrypted.ciphertext),
    };
    corrupted.ciphertext[0] ^= 0xff;
    expect(() => cipher.decrypt(corrupted, 'tenant-a/tool-a/key/7'))
      .toThrow(ServiceUnavailableException);
    expect(() => cipher.decrypt(encrypted, 'tenant-b/tool-a/key/7'))
      .toThrow(ServiceUnavailableException);
  });

  it('defaults to version 1 when SECRET_MASTER_KEY_VERSION is absent (existing-record compatibility)', () => {
    delete process.env.SECRET_MASTER_KEY_VERSION;
    const encrypted = cipher.encrypt('private-value', 'tenant/tool/credential/1');
    expect(encrypted.keyVersion).toBe(1);
    expect(cipher.decrypt(encrypted, 'tenant/tool/credential/1')).toBe('private-value');
  });

  it('fails closed on invalid configured versions', () => {
    for (const invalid of ['0', '-1', 'abc', '']) {
      process.env.SECRET_MASTER_KEY_VERSION = invalid;
      expect(() => cipher.currentVersion()).toThrow(ServiceUnavailableException);
    }
  });

  it('refuses records stored under a previous version once the configured version changes', () => {
    delete process.env.SECRET_MASTER_KEY_VERSION;
    const stored = cipher.encrypt('private-value', 'tenant/tool/credential/1');
    process.env.SECRET_MASTER_KEY_VERSION = '7';
    expect(() => cipher.decrypt(stored, 'tenant/tool/credential/1')).toThrow(ServiceUnavailableException);
  });
});
