import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newUuidv7 } from '../common/ids/uuid';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { VoiceLibraryService } from './voice-library.service';

describe('private consented voice library (provider responses mocked; real FFmpeg)', () => {
  let root: string;
  let service: VoiceLibraryService;
  let originalRoot: string | undefined;
  let originalProvider: string | undefined;
  let originalNodeEnv: string | undefined;
  const tenant = newUuidv7();
  const otherTenant = newUuidv7();
  const user = newUuidv7();
  const run = <T>(fn: () => T, tenantId = tenant) => tenantContextStore.run({
    tenantId, actorType: 'user', userId: user, permissions: ['assistants:write'],
  }, fn);
  const metadata = { name: 'Consented fixture', language: 'en', consent: 'true' };
  const wav = () => {
    const data = Buffer.alloc(44 + 16000 * 2 * 8);
    data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
    data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
    data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
    data.writeUInt32LE(data.length - 44, 40);
    for (let i = 0; i < 16000 * 8; i++) data.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / 16000)), 44 + i * 2);
    return data;
  };
  const file = (buffer = wav()) => ({ buffer, size: buffer.length, mimetype: 'audio/wav' });
  const wait = async (id: string) => {
    for (let i = 0; i < 300; i++) {
      const profile = await run(() => service.get(id));
      if (!['processing', 'uploaded'].includes(profile.state)) return profile;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Profile processing did not finish.');
  };

  beforeEach(async () => {
    originalRoot = process.env.VOICE_STORAGE_DIR;
    originalProvider = process.env.VOICE_CLONE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    root = await fs.mkdtemp(join(tmpdir(), 'mczen-voice-library-'));
    process.env.VOICE_STORAGE_DIR = root;
    delete process.env.VOICE_CLONE_URL;
    service = new VoiceLibraryService();
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
    if (originalRoot === undefined) delete process.env.VOICE_STORAGE_DIR; else process.env.VOICE_STORAGE_DIR = originalRoot;
    if (originalProvider === undefined) delete process.env.VOICE_CLONE_URL; else process.env.VOICE_CLONE_URL = originalProvider;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    // Only the exact test-owned temporary directory is eligible for cleanup.
    await fs.rm(root, { recursive: true, force: true });
  });
  it('rejects missing consent, unapproved language, scope injection and unsupported media', async () => {
    for (const body of [{ ...metadata, consent: false }, { ...metadata, language: 'te' }, { ...metadata, tenantId: otherTenant }]) {
      await expect(run(() => service.create(file(), body, user))).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(run(() => service.create({ ...file(), mimetype: 'text/plain' }, metadata, user))).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(() => service.create(undefined, metadata, user))).rejects.toBeInstanceOf(BadRequestException);
  });
  it('persists private originals across service recreation and denies foreign tenant IDs and traversal', async () => {
    const profile = await run(() => service.create(file(), metadata, user));
    expect((await fs.readFile(join(root, tenant, profile.id, 'original'))).equals(wav())).toBe(true);
    service = new VoiceLibraryService();
    await expect(run(() => service.get(profile.id))).resolves.toMatchObject({ state: 'uploaded', consent: true, createdBy: user });
    await expect(run(() => service.get(profile.id), otherTenant)).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(() => service.get('..\\..\\private'))).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.activeForTenant(otherTenant)).toEqual([]);
    await run(() => service.remove(profile.id));
    await expect(run(() => service.get(profile.id))).rejects.toBeInstanceOf(NotFoundException);
  });
  it('fails explicitly without a provider and never pretends that an upload is ready', async () => {
    const profile = await run(() => service.create(file(), metadata, user));
    await expect(run(() => service.process(profile.id))).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(run(() => service.setActive(profile.id, true))).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.activeForTenant(tenant)).toEqual([]);
  });
  it('does not expose local-only voice profiles in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(run(() => service.list())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.activeForTenant(tenant)).toEqual([]);
    await expect(service.assertActive(tenant, 'clone:00000000-0000-0000-0000-000000000000', 'en'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('processes real WAV with FFmpeg, requires a preview, scopes publication and revokes immediately', async () => {
    process.env.VOICE_CLONE_URL = 'http://127.0.0.1:8004';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const endpoint = url instanceof URL ? url.href : typeof url === 'string' ? url : url.url;
      if (endpoint.endsWith('/health')) return new Response(JSON.stringify({ healthy: true, service: 'openvoice-v2' }));
      if (endpoint.endsWith('/profiles')) {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ embedding: Buffer.alloc(1024, 1).toString('base64') }));
      }
      return new Response(new Uint8Array(wav()), { headers: { 'Content-Type': 'audio/wav' } });
    });
    const profile = await run(() => service.create(file(), metadata, user));
    await run(() => service.process(profile.id));
    expect((await wait(profile.id)).state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(run(() => service.setActive(profile.id, true))).rejects.toBeInstanceOf(BadRequestException);
    await expect(run(() => service.preview(profile.id, 'Hello.'))).resolves.toBeInstanceOf(Buffer);
    await run(() => service.setActive(profile.id, true));
    expect(await service.activeForTenant(tenant)).toEqual([expect.objectContaining({ id: `clone:${profile.id}`, label: metadata.name })]);
    expect(await service.activeForTenant(otherTenant)).toEqual([]);
    await expect(service.assertActive(otherTenant, `clone:${profile.id}`, 'en')).rejects.toBeInstanceOf(NotFoundException);
    const chunks: Buffer[] = [];
    for await (const chunk of service.synthesize(tenant, {
      text: 'Hello.', voice: `clone:${profile.id}`, language: 'en', rate: 1, signal: new AbortController().signal,
    })) {
      expect(chunk.encoding).toBe('pcm_s16le');
      expect(chunk.sampleRate).toBe(16000);
      chunks.push(chunk.data);
    }
    expect(Buffer.concat(chunks).equals(wav().subarray(44))).toBe(true);
    const aborted = new AbortController(); aborted.abort();
    for await (const _chunk of service.synthesize(tenant, {
      text: 'Hello.', voice: `clone:${profile.id}`, language: 'en', rate: 1, signal: aborted.signal,
    })) { throw new Error('Cancelled speech must not be emitted.'); }
    await expect(run(() => service.remove(profile.id))).rejects.toBeInstanceOf(BadRequestException);
    await run(() => service.setActive(profile.id, false));
    await expect(service.assertActive(tenant, `clone:${profile.id}`, 'en')).rejects.toBeInstanceOf(BadRequestException);
    await run(() => service.remove(profile.id));
  }, 15_000);
  it('marks invalid audio and malformed provider results as failed without exposing private error details', async () => {
    process.env.VOICE_CLONE_URL = 'http://127.0.0.1:8004';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ embedding: 123 })));
    const invalid = await run(() => service.create(file(Buffer.from('not audio')), metadata, user));
    await run(() => service.process(invalid.id));
    expect((await wait(invalid.id)).state).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    const valid = await run(() => service.create(file(), metadata, user));
    await run(() => service.process(valid.id));
    expect((await wait(valid.id)).state).toBe('failed');
    expect((await run(() => service.get(valid.id))).error).not.toContain(root);
  }, 15_000);
});
