import { Repository, ObjectLiteral } from 'typeorm';
export declare abstract class TenantScopedRepository<Entity extends ObjectLiteral> {
    protected readonly repository: Repository<Entity>;
    protected constructor(repository: Repository<Entity>);
    protected currentTenantId(): string;
}
