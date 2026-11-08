import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentModule } from '../agent/agent.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SharedStateModule } from '../shared-state/shared-state.module';
import { MemorySharedState } from '../shared-state/memory-shared-state';
import { SHARED_STATE } from '../shared-state/shared-state';
import { MerchantCartService } from './merchant-cart.service';
import { ToolsModule } from '../tools/tools.module';
import { VoiceModule } from '../voice/voice.module';
import { WidgetRepository } from '../widget/widget.repository';
import { WidgetService } from '../widget/widget.service';
import {
  WebsiteIngestionController,
  WebsiteIntegrationPublicController,
} from './website-integration.controllers';
import { WebsiteIntegrationService } from './website-integration.service';
import { WebsiteIntegrationsModule } from './website-integrations.module';

@Module({})
class EmptyDependenciesModule {}

@Module({
  providers: [{ provide: SHARED_STATE, useClass: MemorySharedState }],
  exports: [SHARED_STATE],
})
class TestSharedStateModule {}

describe('WebsiteIntegrationsModule widget dependency wiring', () => {
  it('resolves both integration controllers through the exported widget provider', async () => {
    const widget = {
      ask: jest.fn().mockResolvedValue({ success: true, answer: 'Hello' }),
      trackWebsitePage: jest.fn().mockResolvedValue({ success: true }),
    };
    const module = await Test.createTestingModule({
      imports: [WebsiteIntegrationsModule],
    })
      .overrideModule(AgentModule).useModule(EmptyDependenciesModule)
      .overrideModule(VoiceModule).useModule(EmptyDependenciesModule)
      .overrideModule(KnowledgeModule).useModule(EmptyDependenciesModule)
      .overrideModule(ToolsModule).useModule(EmptyDependenciesModule)
      .overrideModule(SharedStateModule).useModule(TestSharedStateModule)
      .overrideProvider(WidgetService).useValue(widget)
      .overrideProvider(WidgetRepository).useValue({})
      .overrideProvider(WebsiteIntegrationService).useValue({})
      .compile();

    try {
      const publicController = module.get(WebsiteIntegrationPublicController);
      const ingestionController = module.get(WebsiteIngestionController);
      expect(module.get(MerchantCartService)).toBeInstanceOf(MerchantCartService);
      const origin = 'https://merchant.example';

      await expect(publicController.message(
        { message: 'Hello' }, 'Bearer session-token', origin,
      )).resolves.toEqual({ success: true, answer: 'Hello' });
      expect(widget.ask).toHaveBeenCalledWith('session-token', origin, 'Hello', undefined, undefined);
      const requestId = 'b254ebf4-909c-4c28-9ee5-2d833c5c2286';
      await publicController.message(
        { message: 'Hello again', requestId }, 'Bearer session-token', origin,
      );
      expect(widget.ask).toHaveBeenLastCalledWith('session-token', origin, 'Hello again', undefined, requestId);

      const page = { url: `${origin}/products` };
      await expect(ingestionController.trackPageView(
        'Bearer session-token', origin, page,
      )).resolves.toEqual({ success: true });
      expect(widget.trackWebsitePage).toHaveBeenCalledWith('session-token', origin, page);
    } finally {
      await module.close();
    }
  });
});
