"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretCipher = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
let SecretCipher = class SecretCipher {
    key() {
        const raw = process.env.SECRET_MASTER_KEY?.trim();
        let key;
        if (raw && /^[0-9a-fA-F]{64}$/.test(raw))
            key = Buffer.from(raw, 'hex');
        else if (raw) {
            const b = Buffer.from(raw, 'base64');
            if (b.length === 32)
                key = b;
        }
        if (!key)
            throw new common_1.ServiceUnavailableException('Secret storage is not configured.');
        return key;
    }
    encrypt(plain, aad) {
        const iv = (0, node_crypto_1.randomBytes)(12);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', this.key(), iv);
        cipher.setAAD(Buffer.from(aad));
        const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
    }
    decrypt(payload, aad) {
        const [version, iv, tag, ct] = payload.split(':');
        if (version !== 'v1' || !iv || !tag || !ct)
            throw new common_1.ServiceUnavailableException('Secret storage is not configured.');
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
    }
};
exports.SecretCipher = SecretCipher;
exports.SecretCipher = SecretCipher = __decorate([
    (0, common_1.Injectable)()
], SecretCipher);
//# sourceMappingURL=secret-cipher.service.js.map