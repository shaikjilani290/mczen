import { MigrationInterface, QueryRunner } from 'typeorm';
export declare class AuthPendingTokens1740000000004 implements MigrationInterface {
    up(queryRunner: QueryRunner): Promise<void>;
    down(queryRunner: QueryRunner): Promise<void>;
}
