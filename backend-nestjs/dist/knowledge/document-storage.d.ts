export declare abstract class DocumentStorage {
    abstract put(key: string, data: Buffer): Promise<void>;
    abstract get(key: string): Promise<Buffer>;
    abstract delete(key: string): Promise<void>;
}
export declare class LocalDocumentStorage extends DocumentStorage {
    private readonly root;
    private pathFor;
    put(key: string, data: Buffer): Promise<void>;
    get(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
}
