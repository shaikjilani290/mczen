"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRuntimeConfigService = void 0;
exports.readAgentRuntimeConfig = readAgentRuntimeConfig;
const common_1 = require("@nestjs/common");
function invalidSetting(name) {
    throw new Error(`Invalid agent configuration: ${name}.`);
}
function integerSetting(env, name, fallback, minimum, maximum) {
    const raw = env[name];
    if (raw === undefined) {
        return fallback;
    }
    if (!/^\d+$/.test(raw)) {
        return invalidSetting(name);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        return invalidSetting(name);
    }
    return value;
}
function validatedBaseUrl(raw, settingName) {
    let parsedUrl;
    try {
        parsedUrl = new URL(raw);
    }
    catch {
        return invalidSetting(settingName);
    }
    if (raw.length > 2048 ||
        raw !== raw.trim() ||
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        !parsedUrl.hostname ||
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.search ||
        parsedUrl.hash) {
        return invalidSetting(settingName);
    }
    return parsedUrl.href.replace(/\/+$/, '');
}
function readAgentRuntimeConfig(env) {
    const provider = env['LLM_PROVIDER'] ?? 'ollama';
    if (provider !== 'ollama' && provider !== 'openai-compatible') {
        return invalidSetting('LLM_PROVIDER');
    }
    const ollamaBaseUrl = validatedBaseUrl(env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434', 'OLLAMA_BASE_URL');
    const ollamaModel = env['OLLAMA_MODEL'] ?? 'qwen2.5:3b';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(ollamaModel)) {
        return invalidSetting('OLLAMA_MODEL');
    }
    const llmBaseUrl = validatedBaseUrl(env['LLM_BASE_URL'] ?? 'http://127.0.0.1:21434/v1', 'LLM_BASE_URL');
    const llmModel = env['LLM_MODEL'] ?? 'Qwen2.5-3B-Instruct';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(llmModel)) {
        return invalidSetting('LLM_MODEL');
    }
    return Object.freeze({
        llmProvider: provider,
        llmBaseUrl,
        llmModel,
        ollamaBaseUrl,
        ollamaModel,
        ollamaTimeoutMs: integerSetting(env, 'OLLAMA_TIMEOUT_MS', 120_000, 1_000, 300_000),
        maxRounds: integerSetting(env, 'AGENT_MAX_ROUNDS', 4, 1, 4),
        maxToolCalls: integerSetting(env, 'AGENT_MAX_TOOL_CALLS', 5, 1, 5),
    });
}
let AgentRuntimeConfigService = class AgentRuntimeConfigService {
    values = readAgentRuntimeConfig(process.env);
};
exports.AgentRuntimeConfigService = AgentRuntimeConfigService;
exports.AgentRuntimeConfigService = AgentRuntimeConfigService = __decorate([
    (0, common_1.Injectable)()
], AgentRuntimeConfigService);
//# sourceMappingURL=agent-runtime-config.service.js.map