import { DynamicModule } from '@nestjs/common';
export declare const DATABASE_STATUS: unique symbol;
export interface DatabaseStatus {
    configured: boolean;
    message: string;
}
export declare class DatabaseModule {
    private static readonly logger;
    static forRoot(): DynamicModule;
}
