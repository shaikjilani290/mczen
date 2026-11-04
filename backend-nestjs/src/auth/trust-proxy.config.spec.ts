import { readTrustProxySetting, TrustProxyConfigError } from './trust-proxy.config';

describe('MCZEN_TRUST_PROXY parsing', () => {
  it('keeps forwarding headers untrusted when the variable is unset or blank', () => {
    expect(readTrustProxySetting({})).toBe(false);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: undefined })).toBe(false);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '' })).toBe(false);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '   ' })).toBe(false);
  });

  it('accepts only explicit IP addresses, including IPv6 and comma lists', () => {
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '127.0.0.1' })).toEqual(['127.0.0.1']);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '::1' })).toEqual(['::1']);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '127.0.0.1,::1' })).toEqual(['127.0.0.1', '::1']);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: ' 127.0.0.1 , ::1 ' })).toEqual(['127.0.0.1', '::1']);
    expect(readTrustProxySetting({ MCZEN_TRUST_PROXY: '::ffff:127.0.0.1' })).toEqual(['::ffff:127.0.0.1']);
  });

  it.each(['true', '1', 'loopback', 'localhost', 'nginx.internal', '127.0.0.0/8', '127.0.0.1/32', '*', 'X-Forwarded-For', ',,,'])(
    'rejects unsafe or non-literal values: %s',
    (value) => {
      expect(() => readTrustProxySetting({ MCZEN_TRUST_PROXY: value })).toThrow(TrustProxyConfigError);
    },
  );

  it.each(['127.0.0.1,', ',127.0.0.1', '127.0.0.1,,::1', ',', ' , '])(
    'fails closed on malformed comma-separated lists with empty entries: %s',
    (value) => {
      expect(() => readTrustProxySetting({ MCZEN_TRUST_PROXY: value })).toThrow(TrustProxyConfigError);
    },
  );

  it('never echoes the configured value in errors', () => {
    let message = '';
    try { readTrustProxySetting({ MCZEN_TRUST_PROXY: 'secret-host-name' }); } catch (error) { message = (error as Error).message; }
    expect(message).not.toContain('secret-host-name');
  });
});
