"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUuidv7 = isUuidv7;
exports.newUuidv7 = newUuidv7;
exports.uuidToBinary = uuidToBinary;
exports.binaryToUuid = binaryToUuid;
exports.newUuidv7Pair = newUuidv7Pair;
const node_crypto_1 = require("node:crypto");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isUuidv7(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}
function newUuidv7(now = Date.now()) {
    const bytes = (0, node_crypto_1.randomBytes)(16);
    bytes.writeUIntBE(Number(BigInt(now) & 0xffffffffffffn), 0, 6);
    bytes.set([0x70 | (bytes.readUInt8(6) & 0x0f)], 6);
    bytes.set([0x80 | (bytes.readUInt8(8) & 0x3f)], 8);
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function uuidToBinary(uuid) {
    const clean = uuid.toLowerCase().replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/.test(clean)) {
        throw new TypeError(`Not a canonical UUID string: ${JSON.stringify(uuid)}.`);
    }
    return Buffer.from(clean, 'hex');
}
function binaryToUuid(binary) {
    if (binary.length !== 16) {
        throw new TypeError(`BINARY(16) value required, received ${binary.length} bytes.`);
    }
    const hex = Buffer.from(binary).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function newUuidv7Pair(now = Date.now()) {
    const id = newUuidv7(now);
    return { id, idBinary: uuidToBinary(id) };
}
//# sourceMappingURL=uuid.js.map