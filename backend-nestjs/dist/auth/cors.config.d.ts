import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
export declare class CorsConfigError extends Error {
}
export declare const WIDGET_PUBLIC_PATH = "/api/widget/public/";
export declare const WEBSITE_PUBLIC_PATHS: readonly string[];
export declare const widgetCorsOptions: CorsOptions;
export declare function readCorsOptions(env?: Record<string, string | undefined>): CorsOptions;
