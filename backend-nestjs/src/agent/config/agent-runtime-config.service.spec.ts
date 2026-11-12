import {
  AgentRuntimeConfigService,
  readAgentRuntimeConfig,
} from './agent-runtime-config.service';

describe('Agent runtime configuration', () => {
  it('provides the existing local defaults', () => {
    expect(readAgentRuntimeConfig({})).toEqual({
      responseMode: 'no-llm',
      llmProvider: 'ollama',
      llmBaseUrl: 'http://127.0.0.1:21434/v1',
      llmModel: 'Qwen2.5-3B-Instruct',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen2.5:3b',
      ollamaTimeoutMs: 120_000,
      ollamaFallbackEnabled: false,
      maxRounds: 4,
      maxToolCalls: 5,
    });
  });

  it('accepts validated overrides and normalizes trailing slashes', () => {
    expect(
      readAgentRuntimeConfig({
        AGENT_RESPONSE_MODE: 'conversational',
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'https://llm.example.test/v1/',
        LLM_MODEL: 'local/model',
        OLLAMA_BASE_URL: 'https://ollama.example.test/local/',
        OLLAMA_MODEL: 'local/model:latest',
        OLLAMA_TIMEOUT_MS: '15000',
        OLLAMA_FALLBACK_ENABLED: 'true',
        AGENT_MAX_ROUNDS: '3',
        AGENT_MAX_TOOL_CALLS: '2',
      }),
    ).toEqual({
      responseMode: 'conversational',
      llmProvider: 'openai-compatible',
      llmBaseUrl: 'https://llm.example.test/v1',
      llmModel: 'local/model',
      ollamaBaseUrl: 'https://ollama.example.test/local',
      ollamaModel: 'local/model:latest',
      ollamaTimeoutMs: 15_000,
      ollamaFallbackEnabled: true,
      maxRounds: 3,
      maxToolCalls: 2,
    });
  });

  it.each([
    ['AGENT_RESPONSE_MODE', 'unknown'],
    ['OLLAMA_BASE_URL', 'not-a-url'],
    ['OLLAMA_BASE_URL', 'file:///internal/server'],
    ['OLLAMA_BASE_URL', 'http://user:secret-password@localhost:11434'],
    ['OLLAMA_BASE_URL', 'http://localhost:11434?key=secret-password'],
    ['OLLAMA_BASE_URL', 'http://localhost:11434#fragment'],
    ['OLLAMA_BASE_URL', ' http://localhost:11434'],
    ['OLLAMA_MODEL', ''],
    ['OLLAMA_MODEL', 'model\nsecret-password'],
    ['OLLAMA_MODEL', 'x'.repeat(129)],
    ['OLLAMA_TIMEOUT_MS', '999'],
    ['OLLAMA_TIMEOUT_MS', '300001'],
    ['OLLAMA_TIMEOUT_MS', '1000.5'],
    ['OLLAMA_TIMEOUT_MS', '1e5'],
    ['OLLAMA_TIMEOUT_MS', 'NaN'],
    ['OLLAMA_FALLBACK_ENABLED', 'yes'],
    ['AGENT_MAX_ROUNDS', '0'],
    ['AGENT_MAX_ROUNDS', '5'],
    ['AGENT_MAX_TOOL_CALLS', '0'],
    ['AGENT_MAX_TOOL_CALLS', '6'],
    ['AGENT_MAX_TOOL_CALLS', ''],
  ])('rejects invalid %s without exposing its value', (name, value) => {
    expect(() => readAgentRuntimeConfig({ [name]: value })).toThrow(
      `Invalid agent configuration: ${name}.`,
    );
  });

  it('ignores unrelated secrets and returns an immutable configuration', () => {
    const config = readAgentRuntimeConfig({ API_SECRET: 'secret-password' });

    expect(Object.isFrozen(config)).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret-password');
    expect(Object.keys(config)).toHaveLength(10);
  });

  it('the injectable service reads configuration once at startup', () => {
    const originalEnv = process.env;

    try {
      process.env = { OLLAMA_MODEL: 'test-model:latest' };
      const service = new AgentRuntimeConfigService();
      process.env['OLLAMA_MODEL'] = 'another-model:latest';

      expect(service.values.ollamaModel).toBe('test-model:latest');
    } finally {
      process.env = originalEnv;
    }
  });
});
