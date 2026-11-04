import type { AuthenticatedUser } from '../auth/auth-context';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { type SharedState } from '../shared-state/shared-state';
import type { VoiceIdentity } from './voice-auth.service';
export declare class VoiceTicketService {
    private readonly store;
    constructor(store: SharedState);
    issue(user: AuthenticatedUser, tenant: TenantContext, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
    }>;
    issueIdentity(identity: VoiceIdentity, origin: string | undefined): Promise<{
        ticket: string;
        expiresInMs: number;
    }>;
    consume(ticket: unknown, origin: string | undefined): Promise<VoiceIdentity>;
    private store_;
    private key;
}
