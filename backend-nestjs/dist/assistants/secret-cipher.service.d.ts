export declare class SecretCipher {
    private key;
    encrypt(plain: string, aad: string): string;
    decrypt(payload: string, aad: string): string;
}
