import { type OnModuleDestroy } from '@nestjs/common';
import type { TtsAudioChunk, TtsRequest } from './tts/tts.port';
export declare const MAX_VOICE_UPLOAD: number;
type State = 'uploaded' | 'processing' | 'ready' | 'failed' | 'active' | 'inactive';
export interface VoiceProfile {
    id: string;
    name: string;
    language: 'en';
    provider: 'openvoice-v2';
    state: State;
    createdBy: string;
    createdAt: string;
    consent: true;
    error: string | null;
}
export declare class VoiceLibraryService implements OnModuleDestroy {
    private readonly root;
    private readonly logger;
    private readonly jobs;
    private readonly slots;
    private tenant;
    private directory;
    private save;
    onModuleDestroy(): Promise<void>;
    list(): Promise<{
        items: VoiceProfile[];
        providerConfigured: boolean;
    }>;
    private getForTenant;
    get(id: string): Promise<VoiceProfile>;
    create(file: {
        buffer: Buffer;
        mimetype: string;
        size: number;
    } | undefined, body: unknown, userId: string): Promise<VoiceProfile>;
    process(id: string): Promise<VoiceProfile>;
    private endpoint;
    private prepare;
    setActive(id: string, active: boolean): Promise<VoiceProfile>;
    preview(id: string, text: string): Promise<Buffer<ArrayBufferLike>>;
    private render;
    activeForTenant(tenant: string): Promise<{
        id: string;
        label: string;
        language: "en";
        provider: "openvoice-v2";
    }[]>;
    assertActive(tenant: string, voice: string, language: string): Promise<void>;
    private healthCheck;
    synthesize(tenant: string, request: TtsRequest): AsyncIterable<TtsAudioChunk>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
export {};
