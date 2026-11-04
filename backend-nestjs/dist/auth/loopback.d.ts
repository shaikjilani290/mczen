import type { RequestHeaders } from '../agent/context/tenant-context.service';
export declare function isDirectLoopback(headers: RequestHeaders, remoteAddress?: string): boolean;
export declare function allowDevelopmentTokens(headers: RequestHeaders, remoteAddress?: string): boolean;
