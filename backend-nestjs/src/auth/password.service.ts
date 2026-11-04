import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Password hashing service (Phase 6A §8.1).
 *
 * Argon2id via `@node-rs/argon2` (prebuilt native bindings) with the
 * OWASP-2024-aligned parameters named by the architecture: memory 19 MiB,
 * iterations 2, parallelism 1. Encoded PHC strings are self-describing, so the
 * schema (`password_hash VARCHAR(255)`) stays hash-algorithm-agnostic and
 * parameters can be recalibrated at deploy time without migration.
 *
 * `verify()` never leaks the failure reason; `dummyVerify()` provides
 * the constant-time dummy-verify used by login to equalize timing between
 * "unknown email" and "known email with wrong password".
 */
@Injectable()
export class PasswordService {
  private static readonly OPTIONS = {
    // The package declares an ambient const enum, incompatible with isolatedModules.
    // Its documented numeric Argon2id discriminant is 2 (index.d.ts).
    algorithm: 2,
    memoryCost: 19456, // 19 MiB
    timeCost: 2, // iterations
    parallelism: 1,
  } as const satisfies Options;

  /** Lazily-created Argon2id hash of random data burned on unknown-email logins. */
  private dummyHash: Promise<string> | undefined;

  async hash(password: string): Promise<string> {
    return hash(password, PasswordService.OPTIONS);
  }

  async verify(encodedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(encodedHash, password);
    } catch {
      // Malformed hashes must fail verification, never leak internals.
      return false;
    }
  }

  /** Cost-equalizing verify against a throwaway hash (unknown-email path). */
  async dummyVerify(): Promise<void> {
    this.dummyHash ??= hash(
      randomBytes(32).toString('base64url'),
      PasswordService.OPTIONS,
    );
    await this.verify(await this.dummyHash, 'mczen-invalid-credential');
  }
}
