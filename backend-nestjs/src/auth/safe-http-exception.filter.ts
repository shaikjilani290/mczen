import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { REQUEST_ID, type AuthenticatedRequest } from './auth-context';

/** Unexpected ORM/parser/SMTP errors are never logged or returned with their data. */
@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<AuthenticatedRequest>();
    if (response.headersSent) return;
    response.setHeader('Cache-Control', 'no-store');
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    const parserStatus = exception && typeof exception === 'object' ? (exception as { status?: unknown }).status : undefined;
    const status = parserStatus === 400 || parserStatus === 413 ? parserStatus : 500;
    if (status === 500) this.logger.error({ code: 'HTTP_UNEXPECTED_ERROR', requestId: request[REQUEST_ID] });
    response.status(status).json({ statusCode: status, message: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid request body.' : 'The request could not be completed.' });
  }
}
