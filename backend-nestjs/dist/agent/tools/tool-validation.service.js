"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolValidationService = void 0;
const common_1 = require("@nestjs/common");
const MAX_TOTAL_INPUT_LENGTH = 32_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_INPUT_DEPTH = 5;
const DEFAULT_MAX_STRING_LENGTH = 2_000;
let ToolValidationService = class ToolValidationService {
    validateToolInput(toolName, input, schema) {
        if (input === null ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
            throw new common_1.BadRequestException(`Tool "${toolName}" requires a JSON object as input.`);
        }
        const source = input;
        for (const key of Object.keys(source)) {
            if (!Object.hasOwn(schema.properties, key)) {
                throw new common_1.BadRequestException(`Tool "${toolName}" received an unexpected input property "${key}".`);
            }
        }
        for (const key of schema.required) {
            if (!Object.hasOwn(source, key) || source[key] === undefined) {
                throw new common_1.BadRequestException(`Tool "${toolName}" requires the input property "${key}".`);
            }
        }
        const validated = {};
        for (const [key, value] of Object.entries(source)) {
            validated[key] = this.validateProperty(toolName, key, value, schema.properties[key], 1);
        }
        const serialized = JSON.stringify(validated);
        if (serialized.length > MAX_TOTAL_INPUT_LENGTH) {
            throw new common_1.BadRequestException(`Tool "${toolName}" input exceeds the maximum allowed size.`);
        }
        return validated;
    }
    validateProperty(toolName, key, value, propertySchema, depth) {
        if (depth > MAX_INPUT_DEPTH) {
            throw new common_1.BadRequestException(`Tool "${toolName}" input nests too deeply.`);
        }
        switch (propertySchema.type) {
            case 'string':
                return this.validateString(toolName, key, value, propertySchema);
            case 'number':
                return this.validateNumber(toolName, key, value, propertySchema);
            case 'boolean':
                if (typeof value !== 'boolean') {
                    throw this.invalid(toolName, key, 'must be a boolean');
                }
                return value;
            case 'array':
                return this.validateArray(toolName, key, value, propertySchema, depth);
            case 'object':
                return this.validateObject(toolName, key, value, propertySchema, depth);
            default: {
                const exhaustive = propertySchema.type;
                throw this.invalid(toolName, key, `has an unsupported schema type (${String(exhaustive)})`);
            }
        }
    }
    validateString(toolName, key, value, propertySchema) {
        if (typeof value !== 'string') {
            throw this.invalid(toolName, key, 'must be a string');
        }
        const maxLength = propertySchema.maxLength ?? DEFAULT_MAX_STRING_LENGTH;
        if (value.length > maxLength) {
            throw this.invalid(toolName, key, `must not exceed ${maxLength} characters`);
        }
        if (propertySchema.enum && !propertySchema.enum.includes(value)) {
            throw this.invalid(toolName, key, `must be one of: ${propertySchema.enum.map((item) => `"${item}"`).join(', ')}`);
        }
        return value;
    }
    validateNumber(toolName, key, value, propertySchema) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw this.invalid(toolName, key, 'must be a finite number');
        }
        if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
            throw this.invalid(toolName, key, `must be at least ${propertySchema.minimum}`);
        }
        if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
            throw this.invalid(toolName, key, `must be at most ${propertySchema.maximum}`);
        }
        return value;
    }
    validateArray(toolName, key, value, propertySchema, depth) {
        if (!Array.isArray(value)) {
            throw this.invalid(toolName, key, 'must be an array');
        }
        if (value.length > MAX_ARRAY_ITEMS) {
            throw this.invalid(toolName, key, `must not contain more than ${MAX_ARRAY_ITEMS} items`);
        }
        const itemSchema = propertySchema.items;
        if (itemSchema) {
            return value.map((item, index) => this.validateProperty(toolName, `${key}[${index}]`, item, itemSchema, depth + 1));
        }
        return [...value];
    }
    validateObject(toolName, key, value, propertySchema, depth) {
        if (value === null ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
            throw this.invalid(toolName, key, 'must be an object');
        }
        const source = value;
        if (propertySchema.properties) {
            for (const nestedKey of Object.keys(source)) {
                if (!Object.hasOwn(propertySchema.properties, nestedKey)) {
                    throw this.invalid(toolName, `${key}.${nestedKey}`, 'is not an accepted property');
                }
            }
            const validated = {};
            for (const [nestedKey, nestedValue] of Object.entries(source)) {
                validated[nestedKey] = this.validateProperty(toolName, `${key}.${nestedKey}`, nestedValue, propertySchema.properties[nestedKey], depth + 1);
            }
            return validated;
        }
        return { ...source };
    }
    invalid(toolName, key, reason) {
        return new common_1.BadRequestException(`Tool "${toolName}" input property "${key}" ${reason}.`);
    }
};
exports.ToolValidationService = ToolValidationService;
exports.ToolValidationService = ToolValidationService = __decorate([
    (0, common_1.Injectable)()
], ToolValidationService);
//# sourceMappingURL=tool-validation.service.js.map