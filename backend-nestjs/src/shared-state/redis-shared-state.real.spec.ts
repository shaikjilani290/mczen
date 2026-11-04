import { RedisSharedState } from './redis-shared-state';
import { runSharedStateContract } from './shared-state.spec';

// Real Redis only. Runs when REDIS_TEST_URL points at a disposable Redis (never production):
//   REDIS_TEST_URL=redis://127.0.0.1:6379 npm test -- --runInBand src/shared-state/redis-shared-state.real.spec.ts
const url = process.env.REDIS_TEST_URL;

if (url) {
  let state: RedisSharedState | undefined;
  runSharedStateContract('redis', async () => {
    if (!state) {
      state = new RedisSharedState({ url, keyPrefix: `mczen-test:${Date.now()}:` });
      await state.onModuleInit();
    }
    return state;
  });
  afterAll(async () => { await state?.onModuleDestroy(); });
} else {
  describe.skip('SharedState contract: redis (set REDIS_TEST_URL to run against a real Redis)', () => {
    it('skipped', () => undefined);
  });
}
