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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceTicketController = void 0;
const common_1 = require("@nestjs/common");
const auth_decorators_1 = require("../auth/auth.decorators");
const voice_ticket_service_1 = require("./voice-ticket.service");
let VoiceTicketController = class VoiceTicketController {
    tickets;
    constructor(tickets) {
        this.tickets = tickets;
    }
    issue(user, tenant, origin) {
        return this.tickets.issue(user, tenant, origin);
    }
};
exports.VoiceTicketController = VoiceTicketController;
__decorate([
    (0, common_1.Post)('ticket'),
    (0, common_1.HttpCode)(200),
    (0, auth_decorators_1.RequirePermission)('conversations:write'),
    __param(0, (0, auth_decorators_1.CurrentUser)()),
    __param(1, (0, auth_decorators_1.CurrentTenant)()),
    __param(2, (0, common_1.Headers)('origin')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", void 0)
], VoiceTicketController.prototype, "issue", null);
exports.VoiceTicketController = VoiceTicketController = __decorate([
    (0, common_1.Controller)('api/voice'),
    __metadata("design:paramtypes", [voice_ticket_service_1.VoiceTicketService])
], VoiceTicketController);
//# sourceMappingURL=voice-ticket.controller.js.map