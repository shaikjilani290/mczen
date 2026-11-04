export declare const MAX_CHUNKS_PER_ITEM = 2000;
export declare const CHUNK_TARGET = 900;
export declare const CHUNK_MAX = 1400;
export declare const CHUNK_OVERLAP = 120;
export declare function sanitizeText(input: string): string;
export declare function tokenize(text: string): string[];
export declare function chunkText(text: string, options?: {
    target?: number;
    max?: number;
    overlap?: number;
}): string[];
export declare function slugify(name: string): string;
