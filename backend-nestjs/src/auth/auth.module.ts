import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AgentModule } from '../agent/agent.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthStore } from './auth-store.service';
import { AuthMailer } from './auth.mailer';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RateLimitService } from './rate-limit.service';
import { SafeHttpExceptionFilter } from './safe-http-exception.filter';
import { TenantAuthGuard } from '../common/tenant/tenant-context.guard';
import { TenantContextInterceptor } from '../common/tenant/tenant-context.interceptor';

@Module({
  imports: [AgentModule],
  controllers: [AuthController],
  providers: [
    AuthService, AuthStore, PasswordService,
    // Option objects are config, not Nest DI tokens.
    { provide: TokenService, useFactory: () => new TokenService() },
    { provide: AuthMailer, useFactory: () => new AuthMailer() },
    { provide: RateLimitService, useFactory: () => new RateLimitService() },
    TenantAuthGuard,
    { provide: APP_GUARD, useExisting: TenantAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_FILTER, useClass: SafeHttpExceptionFilter },
  ],
  exports: [AuthService, AuthStore, PasswordService, TokenService, RateLimitService],
})
export class AuthModule {}
