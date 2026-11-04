import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthRateLimit, CurrentUser, IdentityOnly, PublicRoute } from './auth.decorators';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-context';
import { bodyObject, normalizeEmail, parseLoginInput, parseLogoutInput, parseRegisterInput } from './auth.dto';
import { allowDevelopmentTokens } from './loopback';

@Controller('api/auth')
@IdentityOnly()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @PublicRoute()
  @AuthRateLimit('register')
  register(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.auth.register(parseRegisterInput(body), allowDevelopmentTokens(request.headers, request.socket.remoteAddress));
  }

  @Post('login')
  @HttpCode(200)
  @PublicRoute()
  @AuthRateLimit('login')
  login(@Body() body: unknown) { return this.auth.login(parseLoginInput(body)); }

  @Post('refresh')
  @HttpCode(200)
  @PublicRoute()
  @AuthRateLimit('refresh')
  refresh(@Body() body: unknown) {
    const input = bodyObject(body, ['refreshToken']);
    return this.auth.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    await this.auth.logout(user.userId, user.sessionId, parseLogoutInput(body));
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) { return this.auth.me(user.userId, user.sessionId); }

  @Post('tenants/:tenantId/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthenticatedUser, @Param('tenantId') tenantId: string, @Body() body: unknown) {
    // A URL tenant id is a membership-checked selection request, NOT execution context.
    bodyObject(body ?? {}, []);
    return this.auth.activate(user.userId, user.sessionId, tenantId);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @PublicRoute()
  @AuthRateLimit('forgot')
  async forgotPassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = bodyObject(body, ['email']);
    const resetToken = await this.auth.requestPasswordReset(normalizeEmail(input.email), allowDevelopmentTokens(request.headers, request.socket.remoteAddress));
    return { success: true, message: 'If the account is eligible, password reset instructions will be sent.', ...(resetToken ? { resetToken } : {}) };
  }

  @Post('reset-password')
  @HttpCode(200)
  @PublicRoute()
  @AuthRateLimit('reset')
  async resetPassword(@Body() body: unknown) {
    const input = bodyObject(body, ['token', 'newPassword']);
    await this.auth.resetPassword(input.token, input.newPassword);
    return { success: true };
  }

  @Post('verify-email')
  @HttpCode(200)
  @PublicRoute()
  @AuthRateLimit('verify')
  async verifyEmail(@Body() body: unknown) {
    const input = bodyObject(body, ['token']);
    await this.auth.verifyEmail(input.token);
    return { success: true };
  }
}
