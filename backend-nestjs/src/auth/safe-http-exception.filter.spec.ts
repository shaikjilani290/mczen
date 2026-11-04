import { BadRequestException, Logger, type ArgumentsHost } from '@nestjs/common';
import { SafeHttpExceptionFilter } from './safe-http-exception.filter';
import { REQUEST_ID } from './auth-context';

function fixture() {
  const response = { headersSent: false, setHeader: jest.fn(), status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ [REQUEST_ID]: 'req-safe' }) }) } as unknown as ArgumentsHost;
  return { host, response };
}
describe('Secret-safe HTTP error handling', () => {
  afterEach(() => jest.restoreAllMocks());
  it('preserves deliberate safe validation errors', () => {
    const { host, response } = fixture();
    new SafeHttpExceptionFilter().catch(new BadRequestException('Invalid request body.'), host);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid request body.' }));
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('never logs or returns unexpected error/ORM parameters', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { host, response } = fixture();
    new SafeHttpExceptionFilter().catch(Object.assign(new Error('raw-password raw-token'), { parameters: ['secret-hash'] }), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ statusCode: 500, message: 'The request could not be completed.' });
    expect(log).toHaveBeenCalledWith({ code: 'HTTP_UNEXPECTED_ERROR', requestId: 'req-safe' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('raw-token');
  });
  it.each([400, 413])('sanitizes parser errors, including JSON containing secrets: %i', (status) => {
    const { host, response } = fixture();
    new SafeHttpExceptionFilter().catch(Object.assign(new SyntaxError('secret JSON body'), { status }), host);
    expect(response.status).toHaveBeenCalledWith(status);
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('secret JSON body');
  });
});
