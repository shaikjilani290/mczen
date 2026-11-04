"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolPermissionService = void 0;
const common_1 = require("@nestjs/common");
let ToolPermissionService = class ToolPermissionService {
    hasPermissions(granted, required) {
        if (required.length === 0) {
            return true;
        }
        if (!granted || granted.length === 0) {
            return false;
        }
        const grantedSet = new Set(granted);
        return required.every((permission) => grantedSet.has(permission));
    }
};
exports.ToolPermissionService = ToolPermissionService;
exports.ToolPermissionService = ToolPermissionService = __decorate([
    (0, common_1.Injectable)()
], ToolPermissionService);
//# sourceMappingURL=tool-permission.service.js.map