import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth-context';
import { KnowledgeService } from '../agent/knowledge.service';
import { ToolRegistryService } from '../agent/tools/tool-registry.service';
import { ToolValidationService } from '../agent/tools/tool-validation.service';
import { ToolConfigurationRepository } from './tool-configuration.repository';
import { ToolSecretCipher } from './tool-secret-cipher';
import { ToolsService } from './tools.service';

describe('ToolsService configuration security', () => {
  const registry = new ToolRegistryService(new KnowledgeService());
  const repository = {
    updateTenant: jest.fn(),
    detail: jest.fn().mockResolvedValue({
      id: 1,
      name: 'get_products',
      display_name: 'Get products',
      is_active: 1,
      enabled: 1,
      config: '{"defaultLimit":2}',
      extra_permissions: null,
      revoked_at: null,
      last_rotated_at: null,
      expires_at: null,
    }),
  } as unknown as ToolConfigurationRepository;
  const service = new ToolsService(registry, repository, new ToolValidationService(), new ToolSecretCipher());
  const actor = { userId: '01900000-0000-7000-8000-000000000001' } as AuthenticatedUser;

  beforeAll(async () => registry.onModuleInit());

  it('rejects secret-shaped fields in non-secret configuration', async () => {
    await expect(service.update('get_products', { config: { apiKey: 'never-store-here' } }, actor))
      .rejects.toThrow(BadRequestException);
    expect(repository.updateTenant).not.toHaveBeenCalled();
  });

  it('validates tenant configuration against the code-owned schema before saving', async () => {
    await service.update('get_products', { config: { defaultLimit: 2 } }, actor);
    expect(repository.updateTenant).toHaveBeenCalledWith(
      'get_products',
      actor.userId,
      expect.objectContaining({ config: { defaultLimit: 2 } }),
    );
    await expect(service.update('get_products', { config: { defaultLimit: 999 } }, actor))
      .rejects.toThrow(BadRequestException);
  });
});
