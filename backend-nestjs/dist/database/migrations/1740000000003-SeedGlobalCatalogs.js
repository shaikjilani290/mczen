"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeedGlobalCatalogs1740000000003 = void 0;
class SeedGlobalCatalogs1740000000003 {
    static ROLES = [
        ['tenant:owner', 'Owner', 'Tenant owner — full control of the tenant', 0],
        ['tenant:admin', 'Admin', 'Tenant administrator', 0],
        ['tenant:editor', 'Editor', 'Content editor and configuration manager', 0],
        ['tenant:member', 'Member', 'Standard working member', 0],
        ['tenant:viewer', 'Viewer', 'Read-only member', 0],
        ['platform:admin', 'Platform Admin', 'McZEN platform staff (reserved)', 1],
    ];
    static PERMISSIONS = [
        ['knowledge:read', 'Read the tenant knowledge base', 'knowledge'],
        ['knowledge:write', 'Manage knowledge sources and documents', 'knowledge'],
        ['products:read', 'Read the tenant product catalogue', 'tools'],
        ['products:write', 'Modify the tenant product catalogue', 'tools'],
        ['orders:read', 'Read tenant orders', 'tools'],
        ['inventory:read', 'Read tenant inventory', 'tools'],
        ['school:read', 'Read tenant school data', 'tools'],
        ['school:write', 'Modify tenant school data', 'tools'],
        ['matrimonial:read', 'Read tenant matrimonial data', 'tools'],
        ['tenants:read', 'Read tenant profile', 'tenant'],
        ['tenants:write', 'Modify tenant profile and settings', 'tenant'],
        ['users:manage', 'Invite, update and remove tenant users', 'tenant'],
        ['api_keys:manage', 'Create and revoke tenant API keys', 'tenant'],
        ['assistants:read', 'Read assistant configurations', 'assistant'],
        ['assistants:write', 'Create and modify assistants', 'assistant'],
        ['tools:read', 'List tools and their tenant configuration', 'tools'],
        ['tools:write', 'Change tenant tool enablement, configuration and secrets', 'tools'],
        ['conversations:read', 'Read conversations, transcripts and tool calls', 'conversation'],
        ['conversations:write', 'Start conversations and send chat messages', 'conversation'],
        ['usage:read', 'Read usage summaries and history', 'billing'],
        ['billing:manage', 'Change subscription and billing settings', 'billing'],
    ];
    async up(queryRunner) {
        for (const [key, name, description, isPlatform] of SeedGlobalCatalogs1740000000003.ROLES) {
            await queryRunner.query(`INSERT IGNORE INTO \`roles\` (\`key\`, \`name\`, \`description\`, \`is_system\`, \`is_platform\`)
         VALUES (?, ?, ?, 1, ?)`, [key, name, description, isPlatform]);
        }
        for (const [key, description, category] of SeedGlobalCatalogs1740000000003.PERMISSIONS) {
            await queryRunner.query(`INSERT IGNORE INTO \`permissions\` (\`key\`, \`description\`, \`category\`)
         VALUES (?, ?, ?)`, [key, description, category]);
        }
        const grants = [
            ['tenant:owner', SeedGlobalCatalogs1740000000003.PERMISSIONS.map(([k]) => k)],
            [
                'tenant:admin',
                SeedGlobalCatalogs1740000000003.PERMISSIONS.map(([k]) => k).filter((k) => k !== 'api_keys:manage' && k !== 'billing:manage'),
            ],
            [
                'tenant:editor',
                [
                    'knowledge:read', 'knowledge:write',
                    'products:read', 'products:write', 'orders:read', 'inventory:read',
                    'school:read', 'school:write', 'matrimonial:read',
                    'tenants:read',
                    'assistants:read', 'assistants:write',
                    'tools:read',
                    'conversations:read', 'conversations:write',
                    'usage:read',
                ],
            ],
            [
                'tenant:member',
                [
                    'knowledge:read', 'products:read', 'orders:read', 'inventory:read',
                    'school:read', 'matrimonial:read', 'tenants:read',
                    'assistants:read', 'tools:read',
                    'conversations:read', 'conversations:write',
                    'usage:read',
                ],
            ],
            [
                'tenant:viewer',
                [
                    'knowledge:read', 'products:read', 'orders:read', 'inventory:read',
                    'school:read', 'matrimonial:read', 'tenants:read',
                    'assistants:read', 'tools:read',
                    'conversations:read', 'usage:read',
                ],
            ],
            ['platform:admin', []],
        ];
        for (const [roleKey, permKeys] of grants) {
            for (const permKey of permKeys) {
                await queryRunner.query(`INSERT IGNORE INTO \`role_permissions\` (\`role_id\`, \`permission_id\`)
           SELECT r.\`id\`, p.\`id\`
             FROM \`roles\` r, \`permissions\` p
            WHERE r.\`key\` = ? AND p.\`key\` = ?`, [roleKey, permKey]);
            }
        }
    }
    async down(queryRunner) {
        await queryRunner.query('DELETE FROM `role_permissions`');
        await queryRunner.query('DELETE FROM `roles`');
        await queryRunner.query('DELETE FROM `permissions`');
    }
}
exports.SeedGlobalCatalogs1740000000003 = SeedGlobalCatalogs1740000000003;
//# sourceMappingURL=1740000000003-SeedGlobalCatalogs.js.map