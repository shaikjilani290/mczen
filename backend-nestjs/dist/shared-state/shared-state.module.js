"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedStateModule = void 0;
exports.createSharedState = createSharedState;
const common_1 = require("@nestjs/common");
const memory_shared_state_1 = require("./memory-shared-state");
const redis_shared_state_1 = require("./redis-shared-state");
const shared_state_1 = require("./shared-state");
const shared_state_config_1 = require("./shared-state.config");
function createSharedState(env = process.env) {
    const config = (0, shared_state_config_1.resolveSharedStateConfig)(env);
    return config.driver === 'redis'
        ? new redis_shared_state_1.RedisSharedState({ url: config.redisUrl, keyPrefix: config.keyPrefix })
        : new memory_shared_state_1.MemorySharedState();
}
let SharedStateModule = class SharedStateModule {
};
exports.SharedStateModule = SharedStateModule;
exports.SharedStateModule = SharedStateModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [{ provide: shared_state_1.SHARED_STATE, useFactory: () => createSharedState() }],
        exports: [shared_state_1.SHARED_STATE],
    })
], SharedStateModule);
//# sourceMappingURL=shared-state.module.js.map