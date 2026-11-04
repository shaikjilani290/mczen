import { type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
export declare class SafeHttpExceptionFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): void;
}
