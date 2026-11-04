import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  AgentRuntimeConfigService,
  readAgentRuntimeConfig,
} from '../src/agent/config/agent-runtime-config.service';
import { ToolAuditService } from '../src/agent/tools/tool-audit.service';
import { readCorsOptions } from '../src/auth/cors.config';
import { configureHttpApplication } from '../src/auth/http.config';

describe('McZEN HTTP runtime (Ollama mocked)', () => {
  let app: INestApplication<App>;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalDevHeader = process.env.MCZEN_ALLOW_DEV_HEADER;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env.MCZEN_ALLOW_DEV_HEADER = '1';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AgentRuntimeConfigService)
      .useValue({ values: readAgentRuntimeConfig({}) })
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureHttpApplication(app, readCorsOptions({ NODE_ENV: 'test', MCZEN_ALLOW_DEV_HEADER: '1' }));
    await app.listen(0, '127.0.0.1');
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Mock Ollama unavailable.'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env['NODE_ENV'] = 'test';
    process.env.MCZEN_ALLOW_DEV_HEADER = '1';
  });

  function queueAssistant(content: string, calls?: unknown[]) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) },
    })));
  }

  function expectAgentBody(body: Record<string, unknown>) {
    expect(Object.keys(body).sort()).toEqual(['answer', 'model', 'sources', 'success', 'toolCalls']);
    expect(typeof body['answer']).toBe('string');
    expect(body['model']).toBe('qwen2.5:3b');
  }

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('McZEN AI API is running!');
  });

  it('GET /api/health remains unchanged', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body.status).toBe('running');
  });

  it('rejects requests without tenant identity before contacting Ollama', async () => {
    await request(app.getHttpServer()).get('/api/agent/tools').expect(401);
    await request(app.getHttpServer()).post('/api/agent/ask').send({ question: 'hello' }).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET /api/agent/tools resolves the development tenant and never returns handlers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/agent/tools').set('x-mczen-tenant-id', 'tenant-a').expect(200);
    expect(response.body.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'knowledge_search', 'get_products', 'get_product_details', 'check_inventory',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('handler');
    expect(response.body).not.toHaveProperty('resolvedDevTenant');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('POST /api/agent/ask preserves normal conversation and the five-field response', async () => {
    queueAssistant('Hello from McZEN.');
    const response = await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a').send({ question: 'hello' }).expect(201);
    expect(response.body.success).toBe(true);
    expectAgentBody(response.body);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('runs knowledge_search over HTTP with sources and a matching audit request ID', async () => {
    queueAssistant('The earning plan uses demonstration data only.');
    const response = await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a').send({ question: 'Explain the earning plan' }).expect(201);
    expect(response.body.sources.length).toBeGreaterThan(0);
    expect(response.body.toolCalls[0].name).toBe('knowledge_search');
    expectAgentBody(response.body);
    const records = app.get(ToolAuditService).list().filter((entry) => entry.requestId === response.headers['x-request-id']);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tenantId: 'tenant-a', toolName: 'knowledge_search', outcome: 'succeeded' });
  });

  it.each(['tenant-a', 'tenant-b'])('runs tenant-scoped demonstration tools over HTTP for %s', async (tenantId) => {
    queueAssistant('', [{ function: { name: 'get_products', arguments: {} } }]);
    queueAssistant('These products are demonstration data only.');
    const response = await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', tenantId).send({ question: 'List products' }).expect(201);
    expect(response.body.success).toBe(true);
    expect(response.body.toolCalls).toEqual([{ name: 'get_products', resultCount: 1 }]);
    expectAgentBody(response.body);
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const toolContent = payload.messages.find((message) => message.role === 'tool')!.content;
    expect(toolContent).toContain(tenantId);
    expect(toolContent).not.toContain(tenantId === 'tenant-a' ? 'prod-b-' : 'prod-a-');
  });

  it('ignores body-supplied tenant and permission overrides and safely denies a foreign product ID', async () => {
    queueAssistant('', [{ function: { name: 'get_product_details', arguments: { productId: 'prod-b-001' } } }]);
    queueAssistant('That item was not found in your demo catalogue.');
    const response = await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a')
      .send({ question: 'Look up this item', tenantId: 'tenant-b', permissions: ['admin:all'] }).expect(201);
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const toolContent = payload.messages.find((message) => message.role === 'tool')!.content;
    expect(JSON.parse(toolContent)).toMatchObject({ tenantId: 'tenant-a', found: false });
    expect(toolContent).not.toContain('prod-b-001');
    const records = app.get(ToolAuditService).list().filter((entry) => entry.requestId === response.headers['x-request-id']);
    expect(records[0].tenantId).toBe('tenant-a');
  });

  it.each([123, null, [], {}, 'x'.repeat(2001)])('rejects invalid questions as HTTP 400', async (question) => {
    await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a').send({ question }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('production rejects the development header on both agent endpoints', async () => {
    process.env['NODE_ENV'] = 'production';
    await request(app.getHttpServer()).get('/api/agent/tools').set('x-mczen-tenant-id', 'tenant-a').expect(401);
    await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a').send({ question: 'hello' }).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the legacy header requires explicit opt-in', async () => {
    delete process.env.MCZEN_ALLOW_DEV_HEADER;
    await request(app.getHttpServer()).get('/api/agent/tools').set('x-mczen-tenant-id', 'tenant-a').expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwarded localhost claims cannot enable the legacy header', async () => {
    await request(app.getHttpServer()).get('/api/agent/tools')
      .set('x-mczen-tenant-id', 'tenant-a').set('X-Forwarded-For', '127.0.0.1').expect(401);
  });

  it('an invalid bearer token never falls back to a valid demo header', async () => {
    await request(app.getHttpServer()).get('/api/agent/tools')
      .set('Authorization', 'Bearer not-a-jwt').set('x-mczen-tenant-id', 'tenant-a').expect(401);
  });

  it('returns the existing response shape and request ID for safe runtime failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('secret-password C:\\private\\internal'));
    const response = await request(app.getHttpServer()).post('/api/agent/ask')
      .set('x-mczen-tenant-id', 'tenant-a').send({ question: 'hello' }).expect(201);
    expect(response.body.success).toBe(false);
    expectAgentBody(response.body);
    expect(JSON.stringify(response.body)).not.toContain('secret-password');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalDevHeader === undefined) delete process.env.MCZEN_ALLOW_DEV_HEADER;
    else process.env.MCZEN_ALLOW_DEV_HEADER = originalDevHeader;
  });
});
