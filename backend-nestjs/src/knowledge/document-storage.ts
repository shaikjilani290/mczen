import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** Storage abstraction: callers only ever see opaque keys, never filesystem locations. */
export abstract class DocumentStorage {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}-[0-9a-f]{8}$/;

@Injectable()
export class LocalDocumentStorage extends DocumentStorage {
  private readonly root = resolve(process.env.KNOWLEDGE_STORAGE_DIR || join(process.cwd(), 'storage', 'knowledge'));

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key.');
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key.');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await fs.mkdir(resolve(full, '..'), { recursive: true });
    await fs.writeFile(full, data, { mode: 0o600 });
  }

  get(key: string): Promise<Buffer> {
    return fs.readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}
