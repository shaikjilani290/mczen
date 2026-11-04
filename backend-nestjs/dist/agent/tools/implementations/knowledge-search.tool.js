"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKnowledgeSearchTool = createKnowledgeSearchTool;
const common_1 = require("@nestjs/common");
const MAX_QUERY_LENGTH = 2000;
function createKnowledgeSearchTool(knowledge) {
    return {
        name: 'knowledge_search',
        description: 'Search connected knowledge documents for verified application information.',
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
            const query = input['query'];
            if (typeof query !== 'string' ||
                query.trim().length === 0 ||
                query.length > MAX_QUERY_LENGTH) {
                throw new common_1.BadRequestException('knowledge_search requires a query between 1 and 2000 characters.');
            }
            return knowledge.search(query.trim(), { tenantId: context.tenantId });
        },
    };
}
//# sourceMappingURL=knowledge-search.tool.js.map