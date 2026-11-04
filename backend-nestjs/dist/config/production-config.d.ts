type Env = Record<string, string | undefined>;
export interface ConfigProblem {
    variable: string;
    problem: string;
}
export declare class ProductionConfigError extends Error {
    readonly problems: readonly ConfigProblem[];
    constructor(problems: readonly ConfigProblem[]);
}
export declare function validateProductionConfig(env?: Env): ConfigProblem[];
export declare function assertProductionConfig(env?: Env): void;
export {};
