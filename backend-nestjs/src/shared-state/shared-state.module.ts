import { Global, Module } from '@nestjs/common';
import { MemorySharedState } from './memory-shared-state';
import { RedisSharedState } from './redis-shared-state';
import { SHARED_STATE, type SharedState } from './shared-state';
import { resolveSharedStateConfig } from './shared-state.config';

export function createSharedState(env: Record<string, string | undefined> = process.env): SharedState {
  const config = resolveSharedStateConfig(env);
  return config.driver === 'redis'
    ? new RedisSharedState({ url: config.redisUrl as string, keyPrefix: config.keyPrefix })
    : new MemorySharedState();
}

@Global()
@Module({
  providers: [{ provide: SHARED_STATE, useFactory: () => createSharedState() }],
  exports: [SHARED_STATE],
})
export class SharedStateModule {}
