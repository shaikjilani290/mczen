
import { NestFactory } from '@nestjs/core';
import { readCorsOptions } from './auth/cors.config';
import { configureHttpApplication } from './auth/http.config';
import { assertProductionConfig } from './config/production-config';
import { loadOptionalDotEnv } from './database/mysql-config';

async function bootstrap() {
  // Node's native loader reads an optional .env and preserves shell overrides.
  // Never create, rewrite, or log the contents of an existing .env file.
  loadOptionalDotEnv();
  // Fail before listening when production configuration is incomplete; messages name variables only.
  assertProductionConfig();
  const cors = readCorsOptions();
  // Module configuration must run AFTER .env is loaded, not at static import time.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule);

  // Phase 6B: allow Nest lifecycle hooks (including the TypeORM connection
  // pool teardown on SIGINT/SIGTERM) to run on shutdown.
  app.enableShutdownHooks();

  // Forwarding headers stay untrusted unless MCZEN_TRUST_PROXY explicitly names
  // the local proxy; the localhost dev-token gate never consults them.
  configureHttpApplication(app, cors);

  await app.listen(process.env.PORT ?? 3000);

  console.log(`McZEN API running at ${await app.getUrl()}`);
}
void bootstrap();
