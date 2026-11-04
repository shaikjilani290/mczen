import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { AuthMailer, AuthMailConfigError } from './auth.mailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const create = jest.mocked(createTransport);
const SMTP = { MCZEN_SMTP_HOST: 'smtp.example.test', MCZEN_SMTP_FROM: 'McZEN <noreply@example.test>', MCZEN_SMTP_USER: 'smtp-user', MCZEN_SMTP_PASSWORD: 'smtp-secret-fixture' };

describe('Vendor-neutral secret-safe authentication mail', () => {
  const originalEnv = process.env.NODE_ENV;
  const sendMail = jest.fn();
  const close = jest.fn();
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    jest.clearAllMocks();
    sendMail.mockResolvedValue({});
    create.mockReturnValue({ sendMail, close } as never);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv; });

  it('fails uniformly in production before an email-dependent identity lookup', () => {
    const mailer = new AuthMailer({});
    process.env.NODE_ENV = 'production';
    expect(mailer.available).toBe(false);
    expect(() => mailer.ensureAvailable()).toThrow(ServiceUnavailableException);
    expect(create).not.toHaveBeenCalled();
  });
  it('does not emit or log a development token when SMTP is absent', async () => {
    const mailer = new AuthMailer({});
    await mailer.verification('private@example.test', 'secret-token-fixture');
    expect(create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('requires verified TLS and suppresses transport debug output', async () => {
    const mailer = new AuthMailer({ ...SMTP, MCZEN_SMTP_PORT: '587', MCZEN_SMTP_SECURE: '0' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, logger: false, debug: false, tls: { rejectUnauthorized: true } }));
    await mailer.verification('user@example.test', 'single-use-token-fixture');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'user@example.test', text: expect.stringContaining('single-use-token-fixture') }));
    mailer.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });
  it('logs only a fixed failure code after an already-committed registration', async () => {
    sendMail.mockRejectedValue(new Error('smtp-secret-fixture private@example.test raw-token-fixture'));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await expect(new AuthMailer(SMTP).verification('private@example.test', 'raw-token-fixture')).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith({ code: 'AUTH_MAIL_DELIVERY_FAILED' });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('raw-token-fixture');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('smtp-secret-fixture');
  });
  it('makes forgot-password/changed-password notifications non-blocking and catches failures', async () => {
    sendMail.mockRejectedValue(new Error('private-mail-token'));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const mailer = new AuthMailer(SMTP);
    expect(mailer.passwordReset('private@example.test', 'private-mail-token')).toBeUndefined();
    expect(mailer.passwordChanged('private@example.test')).toBeUndefined();
    // Flush promise callbacks only; no timers or transport polling.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(warning).toHaveBeenCalledWith({ code: 'AUTH_MAIL_DELIVERY_FAILED' });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-mail-token');
  });
  it.each([{ MCZEN_SMTP_PORT: '0' }, { MCZEN_SMTP_SECURE: 'true' }, { MCZEN_SMTP_FROM: 'bad\r\nheader' }, { MCZEN_SMTP_PASSWORD: undefined }, { MCZEN_SMTP_HOST: 'https://user:secret@host' }])('rejects malformed SMTP configuration without exposing its values: %p', (changes) => {
    expect(() => new AuthMailer({ ...SMTP, ...changes })).toThrow(AuthMailConfigError);
  });
});
