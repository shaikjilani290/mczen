import { newUuidv7, uuidToBinary, binaryToUuid, isUuidv7, newUuidv7Pair } from './uuid';

describe('UUIDv7 helpers (Phase 6B foundation)', () => {
  it('generates canonical UUIDv7 strings with version 7 and RFC 9562 variant', () => {
    for (let i = 0; i < 200; i++) {
      const id = newUuidv7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id[14]).toBe('7'); // version nibble
      expect(['8', '9', 'a', 'b']).toContain(id[19]); // variant 10
      expect(isUuidv7(id)).toBe(true);
    }
  });

  it('encodes the 48-bit unix-epoch-millisecond timestamp', () => {
    const now = 1767200000000; // fixed UTC ms
    const id = newUuidv7(now);
    const tsBits = BigInt(`0x${id.replace(/-/g, '').slice(0, 12)}`);
    expect(Number(tsBits)).toBe(now);
    expect(isUuidv7(newUuidv7(Date.now()))).toBe(true);
  });

  it('isUuidv7 rejects non-v7 / malformed inputs', () => {
    expect(isUuidv7('not-a-uuid')).toBe(false);
    expect(isUuidv7('')).toBe(false);
    expect(isUuidv7(123)).toBe(false);
    expect(isUuidv7(null)).toBe(false);
    // v4-shaped uuid
    expect(isUuidv7('3d8f2b3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(false);
    const v7 = newUuidv7();
    expect(isUuidv7(v7.toUpperCase())).toBe(false); // canonical is lowercase
    expect(isUuidv7(v7)).toBe(true);
  });

  it('round-trips uuid ↔ BINARY(16) losslessly', () => {
    const id = newUuidv7();
    const bin = uuidToBinary(id);
    expect(bin).toBeInstanceOf(Buffer);
    expect(bin.length).toBe(16);
    expect(binaryToUuid(bin)).toBe(id);
    // uuidToBinary is case-insensitive; output canonical lowercase
    expect(binaryToUuid(uuidToBinary(id.toUpperCase()))).toBe(id);
  });

  it('rejects non-canonical or wrong-size conversions (fail closed)', () => {
    expect(() => uuidToBinary('zzzzzzzz-zzzz-7zzz-8zzz-zzzzzzzzzzzz')).toThrow(TypeError);
    expect(() => uuidToBinary('short')).toThrow(TypeError);
    expect(() => binaryToUuid(new Uint8Array(15))).toThrow(TypeError);
    expect(() => binaryToUuid(new Uint8Array(17))).toThrow(TypeError);
  });

  it('newUuidv7Pair returns the same identity in both representations', () => {
    const { id, idBinary } = newUuidv7Pair();
    expect(binaryToUuid(idBinary)).toBe(id);
    expect(isUuidv7(id)).toBe(true);
  });
});
