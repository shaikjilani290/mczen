export declare function isUuidv7(value: unknown): value is string;
export declare function newUuidv7(now?: number): string;
export declare function uuidToBinary(uuid: string): Buffer;
export declare function binaryToUuid(binary: Uint8Array): string;
export declare function newUuidv7Pair(now?: number): {
    id: string;
    idBinary: Buffer;
};
