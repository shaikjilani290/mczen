import { ToolPermissionService } from './tool-permission.service';

describe('ToolPermissionService', () => {
  let service: ToolPermissionService;

  beforeEach(() => {
    service = new ToolPermissionService();
  });

  it('passes tools that require no permissions', () => {
    expect(service.hasPermissions(undefined, [])).toBe(true);
    expect(service.hasPermissions([], [])).toBe(true);
  });

  it('passes when the caller holds every required permission', () => {
    expect(
      service.hasPermissions(
        ['products:read', 'orders:read'],
        ['products:read', 'orders:read'],
      ),
    ).toBe(true);
    expect(
      service.hasPermissions(
        ['products:read', 'products:write', 'orders:read'],
        ['products:read'],
      ),
    ).toBe(true);
  });

  it('rejects when a required permission is missing (test 5)', () => {
    expect(
      service.hasPermissions(['products:read'], ['products:read', 'orders:read']),
    ).toBe(false);
    expect(service.hasPermissions(undefined, ['products:read'])).toBe(false);
    expect(service.hasPermissions([], ['products:read'])).toBe(false);
  });
});
