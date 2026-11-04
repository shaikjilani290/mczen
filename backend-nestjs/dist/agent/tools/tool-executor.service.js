"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolExecutorService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const agent_execution_context_interface_1 = require("../context/agent-execution-context.interface");
const tool_registry_service_1 = require("./tool-registry.service");
const tool_permission_service_1 = require("./tool-permission.service");
const tool_validation_service_1 = require("./tool-validation.service");
const tool_audit_service_1 = require("./tool-audit.service");
let ToolExecutorService = class ToolExecutorService {
    toolRegistry;
    permissions;
    validation;
    audit;
    constructor(toolRegistry, permissions, validation, audit) {
        this.toolRegistry = toolRegistry;
        this.permissions = permissions;
        this.validation = validation;
        this.audit = audit;
    }
    async execute(toolName, input, context, signal, options) {
        const startedAt = Date.now();
        const name = typeof toolName === 'string' &&
            /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(toolName)
            ? toolName
            : undefined;
        const argumentsSummary = {
            keys: input && typeof input === 'object' && !Array.isArray(input)
                ? Object.keys(input).filter((key) => !/(secret|password|token|credential|api.?key|authorization|private.?key)/i.test(key)).sort().slice(0, 30)
                : [],
        };
        const serializedSummary = JSON.stringify(argumentsSummary);
        const argumentsDigest = (0, node_crypto_1.createHash)('sha256').update(serializedSummary).digest('hex');
        const finish = async (outcome, errorCode, resultSummary) => {
            await this.audit.record({
                tenantId: context.tenantId,
                toolName: name ?? 'invalid_tool',
                requestId: context.requestId,
                executedAt: new Date(startedAt).toISOString(),
                durationMs: Date.now() - startedAt,
                outcome,
                errorCode,
                assistantId: context.assistantId,
                conversationId: context.conversationId,
                userId: context.userId,
                argumentsDigest,
                argumentsSize: Math.min(serializedSummary.length, 65535),
                argumentsSummary,
                resultSummary,
            });
        };
        if (!(0, agent_execution_context_interface_1.isAgentExecutionContext)(context)) {
            return {
                ok: false,
                error: {
                    code: 'MISSING_CONTEXT',
                    message: 'Tool execution requires a verified tenant context.',
                },
            };
        }
        if (!name) {
            await finish('rejected', 'INVALID_TOOL_NAME');
            return {
                ok: false,
                error: {
                    code: 'INVALID_TOOL_NAME',
                    message: 'The requested tool name is invalid.',
                },
            };
        }
        const tool = this.toolRegistry.getTool(name);
        if (!tool) {
            await finish('rejected', 'TOOL_NOT_FOUND');
            return {
                ok: false,
                error: {
                    code: 'TOOL_NOT_FOUND',
                    message: 'The requested tool is not registered.',
                },
            };
        }
        let settings;
        try {
            settings = await this.toolRegistry.executionSettings(name, context.tenantId, tool, context.assistantId);
        }
        catch {
            await finish('failed', 'EXECUTION_ERROR');
            return {
                ok: false,
                error: {
                    code: 'EXECUTION_ERROR',
                    message: 'Tool configuration could not be loaded.',
                },
            };
        }
        if (!settings.available) {
            await finish('rejected', 'TENANT_NOT_ALLOWED');
            return {
                ok: false,
                error: {
                    code: 'TENANT_NOT_ALLOWED',
                    message: 'The requested tool is not available to this tenant.',
                },
            };
        }
        if (!tool.enabled || !settings.enabled) {
            await finish('rejected', 'TOOL_DISABLED');
            return {
                ok: false,
                error: {
                    code: 'TOOL_DISABLED',
                    message: 'The requested tool is disabled.',
                },
            };
        }
        if (!this.permissions.hasPermissions(context.permissions, settings.requiredPermissions)) {
            await finish('rejected', 'PERMISSION_DENIED');
            return {
                ok: false,
                error: {
                    code: 'PERMISSION_DENIED',
                    message: 'The required tool permissions are missing.',
                },
            };
        }
        if (settings.requiresConfirmation) {
            await finish('rejected', 'CONFIRMATION_REQUIRED');
            return {
                ok: false,
                error: {
                    code: 'CONFIRMATION_REQUIRED',
                    message: 'This tool requires explicit user confirmation.',
                },
            };
        }
        if (options?.allowedToolNames && !options.allowedToolNames.has(name)) {
            await finish('rejected', 'TOOL_NOT_OFFERED');
            return {
                ok: false,
                error: {
                    code: 'TOOL_NOT_OFFERED',
                    message: 'The requested tool is not available for this conversation.',
                },
            };
        }
        let validatedInput;
        try {
            validatedInput = this.validation.validateToolInput(name, input, tool.inputSchema);
        }
        catch {
            await finish('rejected', 'INVALID_INPUT');
            return {
                ok: false,
                error: {
                    code: 'INVALID_INPUT',
                    message: 'The requested tool received invalid input.',
                },
            };
        }
        let secrets;
        try {
            secrets = await this.toolRegistry.executionSecrets(name, context.tenantId);
        }
        catch {
            await finish('failed', 'EXECUTION_ERROR');
            return {
                ok: false,
                error: {
                    code: 'EXECUTION_ERROR',
                    message: 'Tool credentials could not be loaded.',
                },
            };
        }
        return this.runHandler(tool, validatedInput, context, signal, finish, { config: settings.config, secrets }, settings.timeoutMs);
    }
    async runHandler(tool, validatedInput, context, externalSignal, finish, runtime, timeoutMs) {
        if (externalSignal?.aborted) {
            await finish('failed', 'CANCELLED');
            return {
                ok: false,
                error: { code: 'CANCELLED', message: 'Tool execution was cancelled.' },
            };
        }
        const controller = new AbortController();
        let stopCode;
        let stop;
        const stopped = new Promise((_resolve, reject) => {
            stop = (code) => {
                if (stopCode)
                    return;
                stopCode = code;
                reject(new Error('Tool execution stopped.'));
                controller.abort();
            };
        });
        const onExternalAbort = () => stop('CANCELLED');
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
        const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
        try {
            const data = await Promise.race([
                Promise.resolve().then(() => {
                    controller.signal.throwIfAborted();
                    return tool.handler(validatedInput, context, controller.signal, runtime);
                }),
                stopped,
            ]);
            await finish('succeeded', null, summarizeResult(data));
            return { ok: true, data };
        }
        catch {
            if (stopCode === 'CANCELLED') {
                await finish('failed', 'CANCELLED');
                return {
                    ok: false,
                    error: { code: 'CANCELLED', message: 'Tool execution was cancelled.' },
                };
            }
            if (stopCode === 'TIMEOUT') {
                await finish('timed_out', 'TIMEOUT');
                return {
                    ok: false,
                    error: { code: 'TIMEOUT', message: 'Tool execution timed out.' },
                };
            }
            await finish('failed', 'EXECUTION_ERROR');
            return {
                ok: false,
                error: {
                    code: 'EXECUTION_ERROR',
                    message: 'The requested tool could not complete the request.',
                },
            };
        }
        finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onExternalAbort);
        }
    }
};
exports.ToolExecutorService = ToolExecutorService;
exports.ToolExecutorService = ToolExecutorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_service_1.ToolRegistryService,
        tool_permission_service_1.ToolPermissionService,
        tool_validation_service_1.ToolValidationService,
        tool_audit_service_1.ToolAuditService])
], ToolExecutorService);
function summarizeResult(value) {
    if (Array.isArray(value))
        return { resultCount: value.length };
    if (!value || typeof value !== 'object')
        return {};
    const source = value;
    const summary = {};
    for (const key of ['count', 'resultCount', 'total', 'found', 'matched']) {
        const candidate = source[key];
        if (typeof candidate === 'number' || typeof candidate === 'boolean') {
            summary[key] = candidate;
        }
    }
    return summary;
}
//# sourceMappingURL=tool-executor.service.js.map