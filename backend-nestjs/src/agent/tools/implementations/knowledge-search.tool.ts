import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from '../../knowledge.service';
import { ToolDefinition } from '../interfaces/tool-definition.interface';

const MAX_QUERY_LENGTH = 2000;

/**
 * Factory for the knowledge_search tool.
 *
 * The search business logic stays in the existing KnowledgeService — this file
 * only adapts it to the ToolDefinition contract. It is available to all
 * tenants and requires no permissions.
 */
export function createKnowledgeSearchTool(
  knowledge: KnowledgeService,
): ToolDefinition {
  return {
    name: 'knowledge_search',
    description:
      'Search connected knowledge documents for verified application information.',
    category: 'knowledge',
    requiredPermissions: [],
    enabled: true,
    requiresConfirmation: false,
    timeoutMs: 10000,
    tenantMode: 'ALL_TENANTS',
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'The question or keywords to search for.',
          maxLength: MAX_QUERY_LENGTH,
        },
      },
    },
    handler: async (input, context) => {
      // Temporary inline guard preserving the current registry behaviour
      // verbatim. The schema validation service now enforces the same
      // contract before the handler runs; this guard keeps the identical
      // error response for direct callers.
      const query = input['query'];

      if (
        typeof query !== 'string' ||
        query.trim().length === 0 ||
        query.length > MAX_QUERY_LENGTH
      ) {
        throw new BadRequestException(
          'knowledge_search requires a query between 1 and 2000 characters.',
        );
      }

      // The tenant comes only from the trusted execution context, never from `input`.
      return knowledge.search(query.trim(), { tenantId: context.tenantId });
    },
  };
}
