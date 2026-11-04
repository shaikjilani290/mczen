
import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from './auth/auth.decorators';

@Controller()
export class AppController {
  @Get()
  @PublicRoute()
  getHello(): string {
    return 'McZEN AI API is running!';
  }

  @Get('api/health')
  @PublicRoute()
  getHealth() {
    return {
      success: true,
      application: 'McZEN AI Shopping Assistant',
      backend: 'NestJS',
      status: 'running',
    };
  }
}
