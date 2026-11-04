import { Injectable } from '@nestjs/common';

export interface AgentRuntimeConfig {
  readonly ollamaBaseUrl: string;
  readonly ollamaModel: string;
  readonly ollamaTimeoutMs: number;
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

/** Only these five settings are read; the environment is never sent to Ollama. */
export function readAgentRuntimeConfig(
  env: NodeJS.ProcessEnv,
): Readonly<AgentRuntimeConfig> {
  const baseUrl = env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return invalidSetting('OLLAMA_BASE_URL');
  }

  if (
    baseUrl.length > 2048 ||
    baseUrl !== baseUrl.trim() ||
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    return invalidSetting('OLLAMA_BASE_URL');
  }

  const model = env['OLLAMA_MODEL'] ?? 'qwen2.5:3b';

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) {
    return invalidSetting('OLLAMA_MODEL');
  }

  return Object.freeze({
    ollamaBaseUrl: parsedUrl.href.replace(/\/+$/, ''),
    ollamaModel: model,
    ollamaTimeoutMs: integerSetting(
      env,
      'OLLAMA_TIMEOUT_MS',
      120_000,
      1_000,
      300_000,
    ),
    // Environment settings may reduce, but never raise, the existing ceilings.
    maxRounds: integerSetting(env, 'AGENT_MAX_ROUNDS', 4, 1, 4),
    maxToolCalls: integerSetting(env, 'AGENT_MAX_TOOL_CALLS', 5, 1, 5),
  });
}

@Injectable()
export class AgentRuntimeConfigService {
  readonly values = readAgentRuntimeConfig(process.env);
}
