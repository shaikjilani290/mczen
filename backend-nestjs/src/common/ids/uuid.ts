import { randomBytes } from 'node:crypto';

/**
 * UUID helpers for the shared-schema multi-tenant schema (Phase 6A §4.1).
 *
 * API-facing tenant-owned entities use BINARY(16) UUIDv7 primary keys:
 * - UUIDv7 = 48-bit UTC-epoch-ms timestamp + 74 bits of randomness with the
 *   RFC 9562 `ver=0x7` and `var=0b10` fields — time-ordered (friendly to
 *   InnoDB index locality) and non-enumerable.
 * - Storage is plain 16-byte big-endian BINARY(16) (no swap-flag tricks), so
 *   the conversion helpers are the single seam between the String world
 *   (APIs, logs, DTOs) and the binary world (database).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Generates a new UUIDv7 string (RFC 9562: version 7 in nibble 13, variant `10` in nibble 17). */
export function newUuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  // 48-bit unix-ms timestamp occupies bytes 0-5 (writeUIntBE covers 6 bytes);
  // writing all 8 bytes with writeBigUInt64BE would shift it 2 bytes right and
  // let the version/variant bytes below overwrite its low bits.
  bytes.writeUIntBE(Number(BigInt(now) & 0xffffffffffffn), 0, 6); // 48-bit unix ms
  bytes.set([0x70 | (bytes.readUInt8(6) & 0x0f)], 6); // version 7 in the high nibble of byte 6
  bytes.set([0x80 | (bytes.readUInt8(8) & 0x3f)], 8); // variant `10` in the two high bits of byte 8
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Canonical UUID string (any version) → 16-byte big-endian buffer for BINARY(16) columns. */
export function uuidToBinary(uuid: string): Buffer {
  const clean = uuid.toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    throw new TypeError(`Not a canonical UUID string: ${JSON.stringify(uuid)}.`);
  }
  return Buffer.from(clean, 'hex');
}

/** 16-byte BINARY(16) value → hyphenated lowercase canonical UUID string. */
export function binaryToUuid(binary: Uint8Array): string {
  if (binary.length !== 16) {
    throw new TypeError(`BINARY(16) value required, received ${binary.length} bytes.`);
  }
  const hex = Buffer.from(binary).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Convenience: generates a fresh UUIDv7 and returns it with its BINARY(16) form. */
export function newUuidv7Pair(now = Date.now()): { id: string; idBinary: Buffer } {
  const id = newUuidv7(now);
  return { id, idBinary: uuidToBinary(id) };
}
