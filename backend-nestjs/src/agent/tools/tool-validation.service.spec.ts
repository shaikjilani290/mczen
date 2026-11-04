import { BadRequestException } from '@nestjs/common';
import { ToolValidationService } from './tool-validation.service';
import { ToolInputSchema } from './interfaces/tool-definition.interface';

const schema: ToolInputSchema = {
  type: 'object',
  required: ['query'],
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: 'Search text', maxLength: 100 },
    limit: {
      type: 'number',
      description: 'Max results',
      minimum: 1,
      maximum: 50,
    },
    active: { type: 'boolean', description: 'Filter flag' },
    tags: { type: 'array', description: 'Tag list' },
    options: {
      type: 'object',
      description: 'Nested options',
      properties: {
        color: { type: 'string', description: 'Color choice', maxLength: 20 },
      },
    },
  },
};

describe('ToolValidationService', () => {
  let validator: ToolValidationService;

  beforeEach(() => {
    validator = new ToolValidationService();
  });

  it('accepts valid input and returns a copy', () => {
    const input = { query: 'running shoes', limit: 10, active: true };

    const validated = validator.validateToolInput('tool_x', input, schema);

    expect(validated).toEqual(input);
    // Defensive copy, not the same reference.
    expect(validated).not.toBe(input);
  });

  it('rejects non-object inputs (string, array, null)', () => {
    expect(() =>
      validator.validateToolInput('tool_x', 'nonsense', schema),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('tool_x', [1, 2, 3], schema),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('tool_x', null, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects missing required properties (test 6a)', () => {
    expect(() => validator.validateToolInput('tool_x', {}, schema)).toThrow(
      BadRequestException,
    );
    expect(() =>
      validator.validateToolInput('tool_x', { limit: 5 }, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects undeclared properties (test 6b)', () => {
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', injected: 'x' }, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects wrong property types (test 6c)', () => {
    expect(() =>
      validator.validateToolInput('tool_x', { query: 123 }, schema),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', active: 'yes' }, schema),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', tags: 'not-array' }, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects maxLength violations (test 6d)', () => {
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'x'.repeat(101) }, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects minimum/maximum violations (test 6e)', () => {
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', limit: 0 }, schema),
    ).toThrow(BadRequestException);
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', limit: 51 }, schema),
    ).toThrow(BadRequestException);
  });

  it('rejects non-finite numbers', () => {
    expect(() =>
      validator.validateToolInput('tool_x', { query: 'ok', limit: Number.NaN }, schema),
    ).toThrow(BadRequestException);
  });

  it('validates nested object properties and rejects undeclared ones (test 6f)', () => {
    const valid = validator.validateToolInput('tool_x', {
      query: 'ok',
      options: { color: 'blue' },
    }, schema);
    expect(valid).toEqual({ query: 'ok', options: { color: 'blue' } });

    expect(() =>
      validator.validateToolInput('tool_x', {
        query: 'ok',
        options: { color: 'blue', evil: 1 },
      }, schema),
    ).toThrow(BadRequestException);
  });

  it('enforces the total input size limit (test 6g)', () => {
    const bigSchema: ToolInputSchema = {
      type: 'object',
      required: ['blob'],
      additionalProperties: false,
      properties: {
        blob: { type: 'string', description: 'Large text', maxLength: 40_000 },
      },
    };

    expect(() =>
      validator.validateToolInput('tool_x', { blob: 'x'.repeat(35_000) }, bigSchema),
    ).toThrow(BadRequestException);
  });

  it('rejects inherited required properties and non-plain objects', () => {
    expect(() => validator.validateToolInput('tool_x', Object.create({ query: 'inherited' }), schema)).toThrow(BadRequestException);
    expect(() => validator.validateToolInput('tool_x', new Date(), schema)).toThrow(BadRequestException);
  });

  it.each(['__proto__', 'constructor', 'toString'])('rejects undeclared prototype-named properties: %s', (key) => {
    const input = JSON.parse(`{"query":"ok","${key}":{}}`) as unknown;
    expect(() => validator.validateToolInput('tool_x', input, schema)).toThrow(BadRequestException);
  });
});
