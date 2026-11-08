import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
export declare function corsOptionsForPath(path: string, cors: CorsOptions): CorsOptions;
export declare function configureHttpApplication(app: INestApplication, cors: CorsOptions): void;
