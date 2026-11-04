"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolSecretCipher = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
let ToolSecretCipher = class ToolSecretCipher {
    key() {
        const raw = process.env.SECRET_MASTER_KEY?.trim();
        let key;
        if (raw && /^[0-9a-fA-F]{64}$/.test(raw))
            key = Buffer.from(raw, 'hex');
        else if (raw) {
            const decoded = Buffer.from(raw, 'base64');
            if (decoded.length === 32)
                key = decoded;
        }
        if (!key)
            throw new common_1.ServiceUnavailableException('Tool secret storage is not configured.');
        return key;
    }
    currentVersion() {
        const version = Number(process.env.SECRET_MASTER_KEY_VERSION ?? '1');
        if (!Number.isSafeInteger(version) || version < 1) {
            throw new common_1.ServiceUnavailableException('Tool secret storage is not configured.');
        }
        return version;
    }
    encrypt(plain, aad) {
        const keyVersion = this.currentVersion();
        const iv = (0, node_crypto_1.randomBytes)(12);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', this.key(), iv);
        cipher.setAAD(Buffer.from(aad));
        const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        return { keyVersion, ciphertext, iv, authTag: cipher.getAuthTag() };
    }
    decrypt(value, aad) {
        if (value.keyVersion !== this.currentVersion()) {
            throw new common_1.ServiceUnavailableException('Tool secret key version is unavailable.');
        }
        try {
            const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.key(), value.iv);
            decipher.setAAD(Buffer.from(aad));
            decipher.setAuthTag(value.authTag);
            return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]).toString('utf8');
        }
        catch {
            throw new common_1.ServiceUnavailableException('Tool secret could not be decrypted.');
        }
    }
};
exports.ToolSecretCipher = ToolSecretCipher;
exports.ToolSecretCipher = ToolSecretCipher = __decorate([
    (0, common_2.Injectable)()
], ToolSecretCipher);
//# sourceMappingURL=tool-secret-cipher.js.map