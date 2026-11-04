// Optional, explicitly invoked live verification. Never part of normal Jest.
// Uses the installed local Ollama model; never downloads models or creates orders.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { readAgentRuntimeConfig } = require('../dist/agent/config/agent-runtime-config.service');

const backendDirectory = path.resolve(__dirname, '..');
const config = readAgentRuntimeConfig(process.env);
const checks = [];
const ownedChildren = new Set();

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  ownedChildren.delete(child);
}

async function startBackend(mode) {
  const child = spawn(process.execPath, [path.join(backendDirectory, 'dist', 'main.js')], {
    cwd: backendDirectory,
    env: {
      ...process.env, NODE_ENV: mode, PORT: '0',
      OLLAMA_BASE_URL: config.ollamaBaseUrl, OLLAMA_MODEL: config.ollamaModel,
      OLLAMA_TIMEOUT_MS: String(config.ollamaTimeoutMs),
      AGENT_MAX_ROUNDS: String(config.maxRounds), AGENT_MAX_TOOL_CALLS: String(config.maxToolCalls),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownedChildren.add(child);

  try {
    const baseUrl = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Live verification server startup deadline exceeded.')), 20_000);
      const onData = (chunk) => {
        output = (output + String(chunk)).slice(-16_000);
        const match = output.match(/McZEN API running at (http:\/\/\S+)/);
        if (!match) return;
        clearTimeout(timer);
        child.stdout.removeListener('data', onData);
        const port = new URL(match[1]).port;
        resolve(`http://127.0.0.1:${port}`);
      };
      child.stdout.on('data', onData);
      // Drain logs, without printing arguments or raw startup exceptions.
      child.stderr.on('data', () => undefined);
      child.once('error', () => { clearTimeout(timer); reject(new Error('Could not start the verification server.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Verification server exited before readiness.')); });
    });
    // Keep consuming safe server logs so the pipe never blocks later requests.
    child.stdout.on('data', () => undefined);
    return { child, baseUrl };
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function check(name, run) {
  try {
    const details = await run();
    checks.push({ name, passed: true, ...details });
  } catch (error) {
    checks.push({ name, passed: false, error: error instanceof Error ? error.message : 'Verification failed.' });
  }
}

function request(baseUrl, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    signal: AbortSignal.timeout(config.ollamaTimeoutMs * config.maxRounds + 30_000),
  });
}

async function ask(baseUrl, tenantId, question) {
  const response = await request(baseUrl, '/api/agent/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mczen-tenant-id': tenantId },
    body: JSON.stringify({ question }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, 'Existing Nest POST status must be preserved.');
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'model', 'sources', 'success', 'toolCalls']);
  assert.equal(body.model, config.ollamaModel);
  assert.equal(body.success, true, `Agent did not complete: ${body.answer}`);
  assert.ok(typeof body.answer === 'string' && body.answer.trim().length > 0);
  const requestId = response.headers.get('x-request-id');
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  return { body, requestId, httpStatus: response.status };
}

function requireTool(result, name) {
  assert.ok(result.body.toolCalls.some((call) => call.name === name), `Model did not invoke ${name}.`);
}

function summary(result) {
  return {
    requestId: result.requestId, httpStatus: result.httpStatus,
    toolNames: result.body.toolCalls.map((call) => call.name),
    answerExcerpt: result.body.answer.slice(0, 240),
  };
}

async function main() {
  const tagsResponse = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  assert.ok(tagsResponse.ok, 'Local Ollama must be available.');
  const tags = await tagsResponse.json();
  assert.ok(tags.models?.some((model) => model.name === config.ollamaModel), 'Configured Ollama model must already be installed.');

  let server = await startBackend('development');
  try {
    await check('Browser CORS preflight permits the development tenant header', async () => {
      const response = await request(server.baseUrl, '/api/agent/ask', {
        method: 'OPTIONS', headers: {
          Origin: 'http://localhost:5174', 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type,x-mczen-tenant-id',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5174');
      assert.ok(response.headers.get('access-control-allow-headers').includes('x-mczen-tenant-id'));
    });

    await check('Missing tenant identity is rejected on both routes', async () => {
      assert.equal((await request(server.baseUrl, '/api/agent/tools')).status, 401);
      assert.equal((await request(server.baseUrl, '/api/agent/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":"hello"}',
      })).status, 401);
    });

    for (const tenantId of ['tenant-a', 'tenant-b']) {
      await check(`Tool listing with development header — ${tenantId}`, async () => {
        const response = await request(server.baseUrl, '/api/agent/tools', { headers: { 'x-mczen-tenant-id': tenantId } });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.tools.map((tool) => tool.name), ['knowledge_search', 'get_products', 'get_product_details', 'check_inventory']);
        assert.ok(body.tools.every((tool) => tool.enabled && !('handler' in tool)));
      });
    }

    await check('Real Ollama normal conversation', async () => {
      const result = await ask(server.baseUrl, 'tenant-a', 'Hello. Briefly introduce yourself.');
      assert.equal(result.body.toolCalls.length, 0);
      return summary(result);
    });
    await check('Real Ollama knowledge_search and source tracking', async () => {
      const result = await ask(server.baseUrl, 'tenant-a', 'Explain the earning plan using the connected knowledge base.');
      requireTool(result, 'knowledge_search');
      assert.ok(result.body.sources.some((source) => source.id === 'plan-001'));
      return summary(result);
    });

    for (const tenantId of ['tenant-a', 'tenant-b']) {
      const productId = tenantId === 'tenant-a' ? 'prod-a-001' : 'prod-b-001';
      const expectedName = tenantId === 'tenant-a' ? 'ZenRun' : 'ZenAcademy';
      const forbiddenName = tenantId === 'tenant-a' ? 'ZenAcademy' : 'ZenRun';

      await check(`Real Ollama get_products — ${tenantId}`, async () => {
        const result = await ask(server.baseUrl, tenantId, 'Use get_products to list items in my demo catalogue. Include IDs and label them demonstration data.');
        requireTool(result, 'get_products');
        assert.ok(result.body.answer.includes(expectedName));
        assert.ok(!result.body.answer.includes(forbiddenName));
        assert.match(result.body.answer, /demo/i);
        return summary(result);
      });
      await check(`Real Ollama get_product_details — ${tenantId}`, async () => {
        const result = await ask(server.baseUrl, tenantId, `Use get_product_details with productId ${productId}. Summarize the returned demonstration details.`);
        requireTool(result, 'get_product_details');
        assert.ok(result.body.answer.includes(expectedName));
        assert.ok(!result.body.answer.includes(forbiddenName));
        return summary(result);
      });
      await check(`Real Ollama check_inventory — ${tenantId}`, async () => {
        const result = await ask(server.baseUrl, tenantId, `Use check_inventory with productId ${productId}. Report the demonstration stock quantity.`);
        requireTool(result, 'check_inventory');
        assert.match(result.body.answer, tenantId === 'tenant-a' ? /\b42\b/ : /\b120\b/);
        assert.ok(!result.body.answer.includes(forbiddenName));
        return summary(result);
      });
    }

    await check('Real Ollama cross-tenant product lookup reveals no foreign details', async () => {
      const result = await ask(server.baseUrl, 'tenant-a', 'Use get_product_details with productId prod-b-001 in my current catalogue. Never assume the item exists.');
      requireTool(result, 'get_product_details');
      assert.ok(!result.body.answer.includes('ZenAcademy'));
      assert.ok(!result.body.answer.includes('32.5'));
      return summary(result);
    });
    await check('Real Ollama cross-tenant inventory lookup reveals no foreign stock', async () => {
      const result = await ask(server.baseUrl, 'tenant-b', 'Use check_inventory with productId prod-a-001 in my current catalogue. Never assume the item exists.');
      requireTool(result, 'check_inventory');
      assert.ok(!result.body.answer.includes('ZenRun'));
      assert.doesNotMatch(result.body.answer, /\b42\b/);
      return summary(result);
    });

    await stop(server.child);
    server = await startBackend('production');
    await check('Production rejects the development header on both routes', async () => {
      const headers = { 'x-mczen-tenant-id': 'tenant-a' };
      assert.equal((await request(server.baseUrl, '/api/agent/tools', { headers })).status, 401);
      assert.equal((await request(server.baseUrl, '/api/agent/ask', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"question":"hello"}',
      })).status, 401);
    });
  } finally {
    await stop(server.child);
  }

  const failed = checks.filter((entry) => !entry.passed).length;
  console.log(JSON.stringify({ provider: 'Ollama', model: config.ollamaModel, passed: checks.length - failed, failed, checks }, null, 2));
  if (failed) process.exitCode = 1;
}

main().catch(async () => {
  for (const child of ownedChildren) await stop(child);
  console.error('Live verification could not complete. Check local Ollama, the installed model, and the backend build.');
  process.exitCode = 1;
});
