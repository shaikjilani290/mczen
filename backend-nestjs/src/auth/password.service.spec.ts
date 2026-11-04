import { PasswordService } from './password.service';

describe('PasswordService (native Argon2id)', () => {
  const service = new PasswordService();
  const password = 'A long test-only passphrase';

  it('hashes using the approved Argon2id parameters, never plaintext', async () => {
    const encoded = await service.hash(password);
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(encoded).not.toContain(password);
    expect(encoded.length).toBeLessThanOrEqual(255);
    expect(await service.verify(encoded, password)).toBe(true);
    expect(await service.verify(encoded, 'another long passphrase')).toBe(false);
  });
  it('uses a fresh random salt on every hash', async () => {
    const [a, b] = await Promise.all([service.hash(password), service.hash(password)]);
    expect(a).not.toBe(b);
    expect(await service.verify(a, password)).toBe(true);
    expect(await service.verify(b, password)).toBe(true);
  });
  it('fails safely on corrupt stored hashes', async () => {
    expect(await service.verify('not-a-phc-string', password)).toBe(false);
  });
  it('concurrent unknown-email checks share a single random dummy hash', async () => {
    const fresh = new PasswordService();
    const spy = jest.spyOn(fresh, 'verify');
    await Promise.all([fresh.dummyVerify(), fresh.dummyVerify(), fresh.dummyVerify()]);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(new Set(spy.mock.calls.map(([encoded]) => encoded)).size).toBe(1);
    expect(spy.mock.calls[0][0]).toMatch(/^\$argon2id\$/);
  });
});
