import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthStore, MembershipRow, SessionRow, UserRow } from '../auth/auth-store.service';
import type { TokenService } from '../auth/token.service';
import { newUuidv7 } from '../common/ids/uuid';
import { VoiceAuthService } from './voice-auth.service';

describe('VoiceAuthService', () => {
  const tenantId = newUuidv7();
  const userId = newUuidv7();
  const sessionId = newUuidv7();
  const assistantId = newUuidv7();

  it('requires an active user session, tenant membership and conversation permission', async () => {
    const user: UserRow = {
      id: userId,
      email: 'member@example.invalid',
      passwordHash: 'not-used',
      status: 'active',
      emailVerifiedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      displayName: 'Member',
      tokenVersion: 1,
      loginFailureWindowStartedAt: null,
    };
    const session: SessionRow = {
      id: sessionId,
      userId,
      activeTenantId: tenantId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      tokenVersion: 1,
    };
    const membership: MembershipRow = {
      status: 'active',
      roleId: 1,
      roleKey: 'tenant_admin',
      roleIsPlatform: false,
    };
    const store = {
      findUserById: jest.fn().mockResolvedValue(user),
      findSession: jest.fn().mockResolvedValue(session),
      findMembership: jest.fn().mockResolvedValue(membership),
      findTenant: jest.fn().mockResolvedValue({ id: tenantId, status: 'active' }),
      rolePermissions: jest.fn().mockResolvedValue(['conversations:write']),
      touchSession: jest.fn().mockResolvedValue(undefined),
    };
    const tokens = {
      verify: jest.fn().mockReturnValue({
        ok: true,
        claims: { userId, sessionId, tenantId },
      }),
    };
    const service = new VoiceAuthService(tokens as unknown as TokenService, store as unknown as AuthStore);

    await expect(service.authenticate('signed-token')).resolves.toEqual({
      userId,
      sessionId,
      tenantId,
      permissions: ['conversations:write'],
    });
    expect(store.findMembership).toHaveBeenCalledWith(userId, tenantId);
    expect(store.touchSession).toHaveBeenCalledWith(userId, sessionId);

    store.findMembership.mockResolvedValueOnce({ ...membership, status: 'disabled' });
    await expect(service.authenticate('signed-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authorizes assistant settings with tenant-correlated SQL and returns configured nudge time', async () => {
    const database = {
      query: jest.fn().mockResolvedValue([
        {
          speech_enabled: 1,
          stt_engine: 'faster-whisper-small-int8',
          stt_language_hint: 'auto',
          tts_engine: 'piper',
          tts_voice_fallback: null,
          speech_rate: 1,
          vad_sensitivity: 0.5,
          endpoint_silence_ms: 1000,
          min_speech_ms: 80,
          barge_in_enabled: 1,
          silence_nudge_after_s: 15,
          session_idle_timeout_s: 300,
          language_code: 'en',
          is_default: 1,
          voice_enabled: 1,
          tts_voice: 'en_US-amy-medium',
          tts_rate: null,
        },
        {
          language_code: 'te',
          is_default: 0,
          voice_enabled: 0,
          tts_voice: null,
          tts_rate: null,
        },
      ]),
    };
    const service = new VoiceAuthService(
      {} as TokenService,
      {} as AuthStore,
      database as unknown as DataSource,
    );

    const resolved = await service.resolveSettings(tenantId, assistantId, 'auto');
    const [sql, parameters] = database.query.mock.calls[0];
    expect(sql).toContain('a.`tenant_id`=?');
    expect(parameters[1]).toEqual(expect.any(Buffer));
    expect(resolved.allowedLanguages).toEqual(['en', 'te']);
    expect(resolved.ttsLanguages).toEqual(['en']);
    expect(resolved.settings.silenceNudgeMs).toBe(15_000);
    expect(resolved.settings.endpointSilenceMs).toBe(1000);
    expect(resolved.defaultLanguage).toBe('en');
    await expect(service.resolveSettings(tenantId, assistantId, 'te')).resolves.toEqual(
      expect.objectContaining({
        allowedLanguages: ['en', 'te'],
        ttsLanguages: ['en'],
        settings: expect.objectContaining({ ttsVoice: null }),
      }),
    );
  });
  it.each([
    [undefined, 1000], ['invalid', 1000], [100, 300], [2500, 2000], [700, 700],
  ])('uses the 1000ms fallback while preserving clamped or explicit settings: %s', async (configured, expected) => {
    const database = { query: jest.fn().mockResolvedValue([{
      speech_enabled: 1, stt_engine: 'faster-whisper-small-int8', stt_language_hint: 'auto',
      tts_engine: 'piper', speech_rate: 1, vad_sensitivity: 0.5, endpoint_silence_ms: configured,
      min_speech_ms: 80, barge_in_enabled: 1, silence_nudge_after_s: 15, session_idle_timeout_s: 300,
      language_code: 'en', is_default: 1, voice_enabled: 1, tts_voice: 'en_US-amy-medium', tts_rate: null,
    }]) };
    const service = new VoiceAuthService({} as TokenService, {} as AuthStore, database as unknown as DataSource);
    expect((await service.resolveSettings(tenantId, assistantId, 'auto')).settings.endpointSilenceMs).toBe(expected);
  });

  it('rejects inaccessible assistants without leaking whether another tenant owns them', async () => {
    const database = { query: jest.fn().mockResolvedValue([]) };
    const service = new VoiceAuthService(
      {} as TokenService,
      {} as AuthStore,
      database as unknown as DataSource,
    );

    await expect(service.resolveSettings(tenantId, assistantId, 'en')).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.query.mock.calls[0][1][1]).toEqual(expect.any(Buffer));
  });
});
