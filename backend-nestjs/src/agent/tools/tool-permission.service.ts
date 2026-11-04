import { Injectable } from '@nestjs/common';

/**
 * Permission checking for tool execution.
 *
 * Permissions are plain strings in `resource:action` form (e.g.
 * `products:read`, `orders:write`). A caller passes when it holds EVERY
 * permission a tool requires. Tools that require nothing always pass.
 *
 * This service is intentionally stateless and free of registry/tenant logic —
 * the executor orchestrates those checks.
 */
@Injectable()
export class ToolPermissionService {
  /**
   * Whether the granted permission set satisfies the required permission set.
   */
  hasPermissions(
    granted: readonly string[] | undefined,
    required: readonly string[],
  ): boolean {
    if (required.length === 0) {
      return true;
    }

    if (!granted || granted.length === 0) {
      return false;
    }

    const grantedSet = new Set(granted);

    return required.every((permission) => grantedSet.has(permission));
  }
}
