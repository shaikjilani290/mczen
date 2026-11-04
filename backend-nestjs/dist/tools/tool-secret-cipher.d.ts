export interface EncryptedToolSecret {
    keyVersion: number;
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
}
export declare class ToolSecretCipher {
    private key;
    currentVersion(): number;
    encrypt(plain: string, aad: string): EncryptedToolSecret;
    decrypt(value: EncryptedToolSecret, aad: string): string;
}
