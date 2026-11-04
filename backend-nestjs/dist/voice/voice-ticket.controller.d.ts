import type { AuthenticatedUser } from '../auth/auth-context';
import type { TenantContext } from '../common/tenant/tenant-context.store';
import { VoiceTicketService } from './voice-ticket.service';
export declare class VoiceTicketController {
    private readonly tickets;
    constructor(tickets: VoiceTicketService);
    issue(user: AuthenticatedUser, tenant: TenantContext, origin?: string): Promise<{
        ticket: string;
        expiresInMs: number;
    }>;
}
