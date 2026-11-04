import { BadRequestException } from '@nestjs/common';
import { parseTenantToolUpdate, parseToolSecret } from './tools.dto';

describe('tool configuration DTOs', () => {
  it('rejects caller-supplied tenant identifiers', () => {
    expect(() => parseTenantToolUpdate({ enabled: true, tenantId: 'other-tenant' }))
      .toThrow(BadRequestException);
  });

  it('accepts supported settings and rejects malformed permission keys', () => {
    expect(parseTenantToolUpdate({
      enabled: false,
      extraPermissions: ['products:read'],
      config: { defaultLimit: 2 },
    })).toMatchObject({ enabled: false, extraPermissions: ['products:read'], config: { defaultLimit: 2 } });
    expect(() => parseTenantToolUpdate({ extraPermissions: ['*:*'] })).toThrow(BadRequestException);
  });

  it('validates secret values and expiry without reflecting secret contents', () => {
    expect(parseToolSecret({ value: 'secret-value', expiresAt: null })).toEqual({
      value: 'secret-value',
      expiresAt: null,
    });
    expect(() => parseToolSecret({ value: '' })).toThrow(BadRequestException);
    expect(() => parseToolSecret({ value: 'x', tenantId: 'forged' })).toThrow(BadRequestException);
  });
});
