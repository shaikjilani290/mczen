import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class SeedGlobalCatalogs1740000000003 implements MigrationInterface {
    private static readonly ROLES;
    private static readonly PERMISSIONS;
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
