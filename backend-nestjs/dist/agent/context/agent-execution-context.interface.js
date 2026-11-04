"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAgentExecutionContext = isAgentExecutionContext;
const uuid_1 = require("../../common/ids/uuid");
function isAgentExecutionContext(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const context = value;
    return (typeof context.tenantId === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(context.tenantId) &&
        typeof context.requestId === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(context.requestId) &&
        Array.isArray(context.permissions) &&
        (context.assistantId === undefined || (0, uuid_1.isUuidv7)(context.assistantId)) &&
        (context.userId === undefined || (0, uuid_1.isUuidv7)(context.userId)) &&
        (context.conversationId === undefined || (0, uuid_1.isUuidv7)(context.conversationId)) &&
        (context.channel === undefined || context.channel === 'widget') &&
        (context.modality === undefined || context.modality === 'text' || context.modality === 'voice') &&
        (context.language === undefined || context.language === 'en' || context.language === 'hi' || context.language === 'te') &&
        context.permissions.length <= 1000 &&
        context.permissions.every((permission) => typeof permission === 'string' &&
            permission.length > 0 &&
            permission.length <= 128));
}
//# sourceMappingURL=agent-execution-context.interface.js.map