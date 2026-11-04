import { DataSource } from 'typeorm';
import { uuidToBinary } from '../common/ids/uuid';
import { tenantContextStore } from '../common/tenant/tenant-context.store';
import { ToolConfigurationRepository } from './tool-configuration.repository';
import { ToolSecretCipher } from './tool-secret-cipher';

describe('ToolConfigurationRepository tenant scope', () => {
  it('pins every tenant override join to the verified ALS tenant', async () => {
    const tenantId = '01900000-0000-7000-8000-000000000001';
    const query = jest.fn().mockResolvedValue([]);
    const source = { query } as unknown as DataSource;
    const repository = new ToolConfigurationRepository(source, new ToolSecretCipher());

    await tenantContextStore.run({ tenantId, actorType: 'user', permissions: [] }, () =>
      repository.listTenantTools([]),
    );

    expect(query).toHaveBeenCalledTimes(3);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tt.`tenant_id`=?');
    expect(sql).toContain('tc.`tenant_id`=?');
    expect(sql).toContain('ts.`tenant_id`=?');
    expect(params).toEqual([uuidToBinary(tenantId), uuidToBinary(tenantId), uuidToBinary(tenantId)]);
  });

  it('uses a fresh verified tenant id for each request instead of a cached tenant scope', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new ToolConfigurationRepository({ query } as unknown as DataSource, new ToolSecretCipher());
    const tenants = [
      '01900000-0000-7000-8000-000000000001',
      '01900000-0000-7000-8000-000000000002',
    ];

    for (const tenantId of tenants) {
      await tenantContextStore.run({ tenantId, actorType: 'user', permissions: [] }, () => repository.listTenantTools([]));
    }

    const listQueries = query.mock.calls.filter(([sql]) => String(sql).includes('FROM `tools` t'));
    expect(listQueries).toHaveLength(2);
    expect((listQueries[0][1] as unknown[])[0]).toEqual(uuidToBinary(tenants[0]));
    expect((listQueries[1][1] as unknown[])[0]).toEqual(uuidToBinary(tenants[1]));
  });
});
