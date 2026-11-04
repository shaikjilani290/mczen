"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var SafeHttpExceptionFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeHttpExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const auth_context_1 = require("./auth-context");
let SafeHttpExceptionFilter = SafeHttpExceptionFilter_1 = class SafeHttpExceptionFilter {
    logger = new common_1.Logger(SafeHttpExceptionFilter_1.name);
    catch(exception, host) {
        const http = host.switchToHttp();
        const response = http.getResponse();
        const request = http.getRequest();
        if (response.headersSent)
            return;
        response.setHeader('Cache-Control', 'no-store');
        if (exception instanceof common_1.HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();
            response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
            return;
        }
        const parserStatus = exception && typeof exception === 'object' ? exception.status : undefined;
        const status = parserStatus === 400 || parserStatus === 413 ? parserStatus : 500;
        if (status === 500)
            this.logger.error({ code: 'HTTP_UNEXPECTED_ERROR', requestId: request[auth_context_1.REQUEST_ID] });
        response.status(status).json({ statusCode: status, message: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid request body.' : 'The request could not be completed.' });
    }
};
exports.SafeHttpExceptionFilter = SafeHttpExceptionFilter;
exports.SafeHttpExceptionFilter = SafeHttpExceptionFilter = SafeHttpExceptionFilter_1 = __decorate([
    (0, common_1.Catch)()
], SafeHttpExceptionFilter);
//# sourceMappingURL=safe-http-exception.filter.js.map