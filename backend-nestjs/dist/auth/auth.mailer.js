"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthMailer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMailer = exports.AuthMailConfigError = void 0;
const common_1 = require("@nestjs/common");
const nodemailer_1 = require("nodemailer");
class AuthMailConfigError extends Error {
}
exports.AuthMailConfigError = AuthMailConfigError;
let AuthMailer = AuthMailer_1 = class AuthMailer {
    transport;
    from;
    logger = new common_1.Logger(AuthMailer_1.name);
    constructor(env = process.env) {
        const host = env.MCZEN_SMTP_HOST;
        if (!host)
            return;
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
        this.transport = (0, nodemailer_1.createTransport)({
            host, port, secure, requireTLS: !secure,
            auth: env.MCZEN_SMTP_USER ? { user: env.MCZEN_SMTP_USER, pass: env.MCZEN_SMTP_PASSWORD } : undefined,
            tls: { rejectUnauthorized: true }, logger: false, debug: false,
            connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
        });
    }
    get available() { return this.transport !== undefined; }
    ensureAvailable() {
        if (process.env.NODE_ENV === 'production' && !this.available) {
            throw new common_1.ServiceUnavailableException('Email service is unavailable.');
        }
    }
    async verification(email, token) {
        try {
            await this.send(email, 'Verify your McZEN email', `Your single-use verification code is:\n${token}\n\nIt expires in 24 hours. Submit it to POST /api/auth/verify-email using your McZEN client.`);
        }
        catch {
            this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' });
        }
    }
    passwordReset(email, token) {
        void this.send(email, 'Reset your McZEN password', `Your single-use password reset code is:\n${token}\n\nIt expires in 60 minutes. If you did not request this, ignore this message.`)
            .catch(() => this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' }));
    }
    passwordChanged(email) {
        void this.send(email, 'Your McZEN password changed', 'Your McZEN password was changed and all sessions were signed out. If this was not you, contact your administrator.')
            .catch(() => this.logger.warn({ code: 'AUTH_MAIL_DELIVERY_FAILED' }));
    }
    onModuleDestroy() { this.transport?.close(); }
    async send(to, subject, text) {
        if (!this.transport)
            return;
        try {
            await this.transport.sendMail({ from: this.from, to, subject, text });
        }
        catch {
            throw new common_1.ServiceUnavailableException('Email delivery is unavailable.');
        }
    }
};
exports.AuthMailer = AuthMailer;
exports.AuthMailer = AuthMailer = AuthMailer_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], AuthMailer);
//# sourceMappingURL=auth.mailer.js.map