import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ToolInputProperty,
  ToolInputSchema,
} from './interfaces/tool-definition.interface';

/** Hard input-size limits, independent of per-property schema constraints. */
const MAX_TOTAL_INPUT_LENGTH = 32_000; // serialized JSON length
const MAX_ARRAY_ITEMS = 100;
const MAX_INPUT_DEPTH = 5;
/** Cap for strings whose property schema declares no maxLength. */
const DEFAULT_MAX_STRING_LENGTH = 2_000;

/**
 * Strict input validation against a tool's declared JSON-Schema subset.
 *
 * Model-generated arguments are NEVER trusted: anything that is not a plain
 * JSON object, contains undeclared properties, violates a type/constraint, or
 * exceeds the size limits is rejected with a BadRequestException BEFORE any
 * handler runs.
 */
@Injectable()
export class ToolValidationService {
  validateToolInput(
    toolName: string,
    input: unknown,
    schema: ToolInputSchema,
  ): Record<string, unknown> {
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      throw new BadRequestException(
        `Tool "${toolName}" requires a JSON object as input.`,
      );
    }

    const source = input as Record<string, unknown>;

    // additionalProperties is always false in the McZEN schema contract:
    // reject anything the tool did not declare.
    for (const key of Object.keys(source)) {
      if (!Object.hasOwn(schema.properties, key)) {
        throw new BadRequestException(
          `Tool "${toolName}" received an unexpected input property "${key}".`,
        );
      }
    }

    for (const key of schema.required) {
      if (!Object.hasOwn(source, key) || source[key] === undefined) {
        throw new BadRequestException(
          `Tool "${toolName}" requires the input property "${key}".`,
        );
      }
    }

    const validated: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(source)) {
      validated[key] = this.validateProperty(
        toolName,
        key,
        value,
        schema.properties[key],
        1,
      );
    }

    const serialized = JSON.stringify(validated);

    if (serialized.length > MAX_TOTAL_INPUT_LENGTH) {
      throw new BadRequestException(
        `Tool "${toolName}" input exceeds the maximum allowed size.`,
      );
    }

    return validated;
  }

  private validateProperty(
    toolName: string,
    key: string,
    value: unknown,
    propertySchema: ToolInputProperty,
    depth: number,
  ): unknown {
    if (depth > MAX_INPUT_DEPTH) {
      throw new BadRequestException(
        `Tool "${toolName}" input nests too deeply.`,
      );
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
      // The union type makes this unreachable, but fail closed regardless.
      default: {
        const exhaustive: never = propertySchema.type;
        throw this.invalid(
          toolName,
          key,
          `has an unsupported schema type (${String(exhaustive)})`,
        );
      }
    }
  }

  private validateString(
    toolName: string,
    key: string,
    value: unknown,
    propertySchema: ToolInputProperty,
  ): string {
    if (typeof value !== 'string') {
      throw this.invalid(toolName, key, 'must be a string');
    }

    const maxLength = propertySchema.maxLength ?? DEFAULT_MAX_STRING_LENGTH;

    if (value.length > maxLength) {
      throw this.invalid(
        toolName,
        key,
        `must not exceed ${maxLength} characters`,
      );
    }

    if (propertySchema.enum && !propertySchema.enum.includes(value)) {
      throw this.invalid(
        toolName,
        key,
        `must be one of: ${propertySchema.enum.map((item) => `"${item}"`).join(', ')}`,
      );
    }

    return value;
  }

  private validateNumber(
    toolName: string,
    key: string,
    value: unknown,
    propertySchema: ToolInputProperty,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw this.invalid(toolName, key, 'must be a finite number');
    }

    if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
      throw this.invalid(
        toolName,
        key,
        `must be at least ${propertySchema.minimum}`,
      );
    }

    if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
      throw this.invalid(
        toolName,
        key,
        `must be at most ${propertySchema.maximum}`,
      );
    }

    return value;
  }

  private validateArray(
    toolName: string,
    key: string,
    value: unknown,
    propertySchema: ToolInputProperty,
    depth: number,
  ): unknown[] {
    if (!Array.isArray(value)) {
      throw this.invalid(toolName, key, 'must be an array');
    }

    if (value.length > MAX_ARRAY_ITEMS) {
      throw this.invalid(
        toolName,
        key,
        `must not contain more than ${MAX_ARRAY_ITEMS} items`,
      );
    }

    // Items are only structured-validated when the schema declares an item
    // type; arrays of primitives are accepted as-is after the size check.
    const itemSchema = propertySchema.items;

    if (itemSchema) {
      return value.map((item, index) =>
        this.validateProperty(
          toolName,
          `${key}[${index}]`,
          item,
          itemSchema,
          depth + 1,
        ),
      );
    }

    return [...value];
  }

  private validateObject(
    toolName: string,
    key: string,
    value: unknown,
    propertySchema: ToolInputProperty,
    depth: number,
  ): Record<string, unknown> {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      throw this.invalid(toolName, key, 'must be an object');
    }

    const source = value as Record<string, unknown>;

    // Nested objects validate their declared properties (if any) and reject
    // undeclared ones, mirroring the top-level additionalProperties contract.
    if (propertySchema.properties) {
      for (const nestedKey of Object.keys(source)) {
        if (!Object.hasOwn(propertySchema.properties, nestedKey)) {
          throw this.invalid(
            toolName,
            `${key}.${nestedKey}`,
            'is not an accepted property',
          );
        }
      }

      const validated: Record<string, unknown> = {};

      for (const [nestedKey, nestedValue] of Object.entries(source)) {
        validated[nestedKey] = this.validateProperty(
          toolName,
          `${key}.${nestedKey}`,
          nestedValue,
          propertySchema.properties[nestedKey],
          depth + 1,
        );
      }

      return validated;
    }

    return { ...source };
  }

  private invalid(
    toolName: string,
    key: string,
    reason: string,
  ): BadRequestException {
    return new BadRequestException(
      `Tool "${toolName}" input property "${key}" ${reason}.`,
    );
  }
}
