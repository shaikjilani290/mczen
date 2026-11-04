"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var PasswordService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasswordService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const argon2_1 = require("@node-rs/argon2");
let PasswordService = class PasswordService {
    static { PasswordService_1 = this; }
    static OPTIONS = {
        algorithm: 2,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
    };
    dummyHash;
    async hash(password) {
        return (0, argon2_1.hash)(password, PasswordService_1.OPTIONS);
    }
    async verify(encodedHash, password) {
        try {
            return await (0, argon2_1.verify)(encodedHash, password);
        }
        catch {
            return false;
        }
    }
    async dummyVerify() {
        this.dummyHash ??= (0, argon2_1.hash)((0, node_crypto_1.randomBytes)(32).toString('base64url'), PasswordService_1.OPTIONS);
        await this.verify(await this.dummyHash, 'mczen-invalid-credential');
    }
};
exports.PasswordService = PasswordService;
exports.PasswordService = PasswordService = PasswordService_1 = __decorate([
    (0, common_1.Injectable)()
], PasswordService);
//# sourceMappingURL=password.service.js.map