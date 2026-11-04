export declare class TrustProxyConfigError extends Error {
}
export type TrustProxySetting = false | string[];
export declare function readTrustProxySetting(env?: Record<string, string | undefined>): TrustProxySetting;
