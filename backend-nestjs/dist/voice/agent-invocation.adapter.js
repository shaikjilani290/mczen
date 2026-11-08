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
exports.AgentInvocationAdapter = void 0;
const common_1 = require("@nestjs/common");
const agent_service_1 = require("../agent/agent.service");
let AgentInvocationAdapter = class AgentInvocationAdapter {
    agent;
    constructor(agent) {
        this.agent = agent;
    }
    async invoke(question, context, signal) {
        signal.throwIfAborted();
        const result = await this.agent.ask(question, context, { signal });
        signal.throwIfAborted();
        return result;
    }
    async *stream(question, context, signal) {
        signal.throwIfAborted();
        const controller = new AbortController();
        let notify = () => { };
        const abort = () => { controller.abort(); notify(); };
        signal.addEventListener('abort', abort, { once: true });
        const queue = [];
        const startedAt = performance.now();
        let done = false;
        let failure;
        const pending = this.agent.ask(question, context, {
            signal: controller.signal,
            onText: text => { queue.push({ text }); notify(); },
        }).then(response => { queue.push({ response, agentMs: performance.now() - startedAt }); }, error => { failure = error; })
            .finally(() => { done = true; notify(); });
        try {
            while (!done || queue.length) {
                signal.throwIfAborted();
                const event = queue.shift();
                if (event)
                    yield event;
                else
                    await new Promise(resolve => { notify = resolve; });
            }
            if (failure)
                throw failure;
        }
        finally {
            controller.abort();
            signal.removeEventListener('abort', abort);
            void pending;
        }
    }
};
exports.AgentInvocationAdapter = AgentInvocationAdapter;
exports.AgentInvocationAdapter = AgentInvocationAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agent_service_1.AgentService])
], AgentInvocationAdapter);
//# sourceMappingURL=agent-invocation.adapter.js.map