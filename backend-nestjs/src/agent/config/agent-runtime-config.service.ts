
import { Injectable } from '@nestjs/common';

export type LlmProvider = 'ollama' | 'openai-compatible';

export interface AgentRuntimeConfig {
  readonly responseMode: 'no-llm' | 'conversational';
  readonly llmProvider: LlmProvider;
  readonly llmBaseUrl: string;
  readonly llmModel: string;
  readonly ollamaBaseUrl: string;
  readonly ollamaModel: string;
  readonly ollamaTimeoutMs: number;
  readonly ollamaFallbackEnabled: boolean;
  readonly maxRounds: number;
  readonly maxToolCalls: number;
}

/** Configuration errors name the setting, never its potentially secret value. */
function invalidSetting(name: string): never {
  throw new Error(`Invalid agent configuration: ${name}.`);
}

function integerSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];

  if (raw === undefined) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    return invalidSetting(name);
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return invalidSetting(name);
  }

  return value;
}

function validatedBaseUrl(raw: string, settingName: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(raw);
  } catch {
    return invalidSetting(settingName);
  }

  if (
    raw.length > 2048 ||
    raw !== raw.trim() ||
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    return invalidSetting(settingName);
  }

  return parsedUrl.href.replace(/\/+$/, '');
}

/** Only explicitly supported settings are read. */
export function readAgentRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Readonly<AgentRuntimeConfig> {
  const responseMode = env['AGENT_RESPONSE_MODE'] ?? 'no-llm';
  if (responseMode !== 'no-llm' && responseMode !== 'conversational') {
    return invalidSetting('AGENT_RESPONSE_MODE');
  }
  const provider = env['LLM_PROVIDER'] ?? 'ollama';

  if (provider !== 'ollama' && provider !== 'openai-compatible') {
    return invalidSetting('LLM_PROVIDER');
  }

  // Existing Ollama configuration remains supported.
  const ollamaBaseUrl = validatedBaseUrl(
    env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434',
    'OLLAMA_BASE_URL',
  );

  const ollamaModel = env['OLLAMA_MODEL'] ?? 'qwen2.5:3b';

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(ollamaModel)) {
    return invalidSetting('OLLAMA_MODEL');
  }

  // New OpenAI-compatible provider configuration.
  const llmBaseUrl = validatedBaseUrl(
    env['LLM_BASE_URL'] ?? 'http://127.0.0.1:21434/v1',
    'LLM_BASE_URL',
  );

  const llmModel = env['LLM_MODEL'] ?? 'Qwen2.5-3B-Instruct';

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(llmModel)) {
    return invalidSetting('LLM_MODEL');
  }

  const fallbackSetting = env['OLLAMA_FALLBACK_ENABLED'] ?? 'false';
  if (fallbackSetting !== 'true' && fallbackSetting !== 'false') {
    return invalidSetting('OLLAMA_FALLBACK_ENABLED');
  }

  return Object.freeze({
    responseMode,
    llmProvider: provider,
    llmBaseUrl,
    llmModel,
    ollamaBaseUrl,
    ollamaModel,
    ollamaFallbackEnabled: fallbackSetting === 'true',
    ollamaTimeoutMs: integerSetting(
      env,
      'OLLAMA_TIMEOUT_MS',
      120_000,
      1_000,
      300_000,
    ),
    maxRounds: integerSetting(env, 'AGENT_MAX_ROUNDS', 4, 1, 4),
    maxToolCalls: integerSetting(env, 'AGENT_MAX_TOOL_CALLS', 5, 1, 5),
  });
}

@Injectable()
export class AgentRuntimeConfigService {
  readonly values = readAgentRuntimeConfig(process.env);
}
