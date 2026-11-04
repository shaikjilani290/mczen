import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export class AuthMailConfigError extends Error {}

/** Vendor-neutral SMTP adapter. No email, token, credential or underlying SMTP error is logged. */
@Injectable()
export class AuthMailer {
  private readonly transport?: Transporter;
  private readonly from?: string;
  private readonly logger = new Logger(AuthMailer.name);

  constructor(env: Record<string, string | undefined> = process.env) {
    const host = env.MCZEN_SMTP_HOST;
    if (!host) return; // Explicitly unavailable, not a production delivery fallback.
    const port = Number(env.MCZEN_SMTP_PORT ?? '465');
    const secureValue = env.MCZEN_SMTP_SECURE ?? (port === 465 ? '1' : '0');
    const from = env.MCZEN_SMTP_FROM;
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !['0', '1'].includes(secureValue) || !from || /[\r\n]/.test(from) ||
      Boolean(env.MCZEN_SMTP_USER) !== (env.MCZEN_SMTP_PASSWORD !== undefined)) {
      throw new AuthMailConfigError('SMTP configuration is incomplete or invalid.');
    }
    const secure = secureValue === '1';
    this.from = from;
    this.transport = createTransport({
      host, port, secure, requireTLS: !secure,
      auth: env.MCZEN_SMTP_USER ? { user: env.MCZEN_SMTP_USER, pass: env.MCZEN_SMTP_PASSWORD } : undefined,
      tls: { rejectUnauthorized: true }, logger: false, debug: false,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    });
  }

  get available(): boolean { return this.transport !== undefined; }

  /** Applied before identity lookup, so configuration failure never enumerates accounts. */
  ensureAvailable(): void {
    if (process.env.NODE_ENV === 'production' && !this.available) {
      throw new ServiceUnavailableException('Email service is unavailable.');
    }
  }

  async verification(email: string, token: string): Promise<void> {
    // DB creation has already committed. A delivery outage must not turn a
    // successful registration into a misleading retry/duplicate-account error.
    try {
      await this.send(email, 'Verify your McZEN email', `Your single-use verification code is:\n${token}\n\nIt expires in 24 hours. Submit it to POST /api/auth/verify-email using your McZEN client.`);
    } catch {
      this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' });
    }
  }

  passwordReset(email: string, token: string): void {
    // Delivery latency/failure must not make forgot-password distinguish known emails.
    void this.send(email, 'Reset your McZEN password', `Your single-use password reset code is:\n${token}\n\nIt expires in 60 minutes. If you did not request this, ignore this message.`)
      .catch(() => this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' }));
  }

  passwordChanged(email: string): void {
    void this.send(email, 'Your McZEN password changed', 'Your McZEN password was changed and all sessions were signed out. If this was not you, contact your administrator.')
      .catch(() => this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' }));
  }

  onModuleDestroy(): void { this.transport?.close(); }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transport) return; // Development without SMTP only; ensureAvailable guards production issuance.
    try { await this.transport.sendMail({ from: this.from, to, subject, text }); }
    catch { throw new ServiceUnavailableException('Email delivery is unavailable.'); }
  }
}
