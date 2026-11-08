import { ServiceUnavailableException } from '@nestjs/common';
import { WidgetVoiceService } from './widget-voice.service';

function build(overrides: { healthy?: boolean[]; tts?: string[]; settings?: object | Error } = {}) {
  const [stt, tts, vad] = overrides.healthy ?? [true, true, true];
  const port = (ok: boolean) => ({ healthCheck: jest.fn(async () => ok) });
  const ports = { stt: port(stt), tts: {
    ...port(tts), supports: jest.fn((l: string) => (overrides.tts ?? ['en', 'hi']).includes(l)),
    voices: (language: string) => [{ id: `${language}-voice`, label: `${language} voice`, language, gender: 'female' }],
  }, vad: port(vad) };
  const settings = overrides.settings ?? { allowedLanguages: ['en', 'hi', 'te'], ttsLanguages: ['en', 'hi', 'te'] };
  const auth = { resolveSettings: jest.fn(async () => { if (settings instanceof Error) throw settings; return settings; }) };
  const tickets = { issueIdentity: jest.fn(async () => ({ ticket: 'mzt_x', expiresInMs: 30000 })) };
  const service = new WidgetVoiceService(auth as never, tickets as never, ports.stt as never, ports.tts as never, ports.vad as never);
  return { service, auth, tickets, ports };
}

describe('WidgetVoiceService', () => {
  it('reports speech languages only when the TTS provider supports them; Telugu stays text-only', async () => {
    const { service } = build();
    await expect(service.availability('t', 'a')).resolves.toEqual({
      available: true, speechLanguages: ['en', 'hi'], textOnlyLanguages: ['te'],
      diagnostics: { unavailable: [] },
      voices: [{ id: 'en-voice', label: 'en voice', language: 'en', gender: 'female' },
        { id: 'hi-voice', label: 'hi voice', language: 'hi', gender: 'female' }],
    });
  });

  it('is unavailable when any engine is unhealthy, without consulting settings', async () => {
    for (const healthy of [[false, true, true], [true, false, true], [true, true, false]]) {
      const { service, auth } = build({ healthy });
      await expect(service.availability('t', 'a')).resolves.toMatchObject({ available: false });
      expect(auth.resolveSettings).not.toHaveBeenCalled();
    }
  });

  it('is unavailable when no language is speakable or settings fail to resolve', async () => {
    await expect(build({ tts: [] }).service.availability('t', 'a')).resolves.toMatchObject({ available: false });
    await expect(build({ settings: new Error('db') }).service.availability('t', 'a')).resolves.toMatchObject({ available: false });
  });

  it('caches health probes and coalesces concurrent checks', async () => {
    const { service, ports } = build();
    await Promise.all([service.availability('t', 'a'), service.availability('t', 'a'), service.availability('t', 'b')]);
    await service.availability('t', 'a');
    expect(ports.stt.healthCheck).toHaveBeenCalledTimes(1);
  });

  it('identifies failed dependencies without exposing internal endpoints', async () => {
    const { service } = build({ healthy: [false, true, false] });
    await expect(service.availability('t', 'a')).resolves.toMatchObject({
      available: false, diagnostics: { unavailable: ['stt', 'vad'], reason: 'engines_unavailable' },
    });
    await expect(build({ settings: new Error('private database details') }).service.availability('t', 'a'))
      .resolves.toMatchObject({ diagnostics: { unavailable: [], reason: 'assistant_settings_unavailable' } });
    await expect(build({ tts: [] }).service.availability('t', 'a'))
      .resolves.toMatchObject({ diagnostics: { reason: 'no_speech_language' } });
  });

  it('issues a widget-bound ticket with only public catalogue permissions', async () => {
    const { service, tickets } = build();
    const result = await service.issueTicket({ tenantId: 't', assistantId: 'a', conversationId: 'c', widgetSessionId: 'w', origin: 'https://shop.test' });
    expect(result.ticket).toBe('mzt_x');
    expect(tickets.issueIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't',
        permissions: ['knowledge:read', 'products:read', 'inventory:read'],
        widget: { assistantId: 'a', conversationId: 'c', widgetSessionId: 'w' },
      }),
      'https://shop.test',
    );
  });

  it('refuses to issue a ticket when voice is unavailable', async () => {
    const { service, tickets } = build({ healthy: [true, false, true] });
    await expect(service.issueTicket({ tenantId: 't', assistantId: 'a', conversationId: 'c', widgetSessionId: 'w', origin: 'https://shop.test' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tickets.issueIdentity).not.toHaveBeenCalled();
  });
});
