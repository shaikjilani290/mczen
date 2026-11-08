import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth-context';
import { VoiceLibraryService } from './voice-library.service';
export declare class VoiceLibraryController {
    private readonly library;
    constructor(library: VoiceLibraryService);
    list(): Promise<{
        items: import("./voice-library.service").VoiceProfile[];
        providerConfigured: boolean;
    }>;
    upload(file: {
        buffer: Buffer;
        mimetype: string;
        size: number;
    } | undefined, body: unknown, user: AuthenticatedUser): Promise<import("./voice-library.service").VoiceProfile>;
    process(id: string): Promise<import("./voice-library.service").VoiceProfile>;
    setActive(id: string, body: unknown): Promise<import("./voice-library.service").VoiceProfile>;
    preview(id: string, body: unknown, response: Response): Promise<StreamableFile>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
