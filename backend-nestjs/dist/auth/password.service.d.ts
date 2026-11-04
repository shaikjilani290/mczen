export declare class PasswordService {
    private static readonly OPTIONS;
    private dummyHash;
    hash(password: string): Promise<string>;
    verify(encodedHash: string, password: string): Promise<boolean>;
    dummyVerify(): Promise<void>;
}
