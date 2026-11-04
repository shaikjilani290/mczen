import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { TenantContextService } from './context/tenant-context.service';
import { ToolRegistryService } from './tools/tool-registry.service';

describe('AgentController', () => {
  let controller: AgentController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: AgentService, useValue: { ask: jest.fn() } },
        {
          provide: ToolRegistryService,
          useValue: {
            listForTenant: jest.fn().mockReturnValue([]),
            listForTenantAtCallTime: jest.fn().mockResolvedValue([]),
            listTools: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: TenantContextService,
          useValue: {
            resolve: jest.fn().mockReturnValue({
              tenantId: 'tenant-a',
              permissions: [],
              requestId: 'req-test',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AgentController>(AgentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('rejects questions that exceed the 2000 character limit', async () => {
    await expect(controller.ask({ question: 'x'.repeat(2001) })).rejects.toThrow();
  });

  it('scopes GET /tools to the resolved tenant', async () => {
    const response = await controller.getTools();

    expect(response.success).toBe(true);
    expect(Array.isArray(response.tools)).toBe(true);
    expect(response).not.toHaveProperty('resolvedDevTenant');
  });

  it.each([123, true, [], {}])('rejects non-string questions as HTTP 400 rather than throwing a TypeError: %p', async (question) => {
    await expect(controller.ask({ question })).rejects.toThrow(BadRequestException);
  });

  it('returns the backend request ID in a header without adding response body fields', async () => {
    const response = { setHeader: jest.fn() } as unknown as Response;
    await controller.ask({ question: 'hello' }, response);

    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-test');
  });
});
