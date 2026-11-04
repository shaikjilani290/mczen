export declare const MAX_UPLOAD_BYTES: number;
export declare const MAX_EXTRACTED_CHARS = 1000000;
export declare const MAX_PDF_PAGES = 300;
export type DocumentFileType = 'pdf' | 'docx' | 'txt';
export interface UploadedFileLike {
    originalname: string;
    size: number;
    buffer: Buffer;
}
export interface ValidatedUpload {
    fileType: DocumentFileType;
    displayName: string;
}
export declare function safeFilename(name: string): string;
export declare function validateUpload(file: UploadedFileLike | undefined): ValidatedUpload;
export declare class ExtractionError extends Error {
    readonly code: string;
    constructor(code: string);
}
export declare function extractTxt(buf: Buffer): string;
export declare function readZipEntry(buf: Buffer, wanted: string): Buffer | undefined;
export declare function extractDocx(buf: Buffer): string;
export interface PdfTextExtractor {
    extract(buf: Buffer): Promise<string>;
}
export type PdfJsLoader = () => Promise<any>;
export declare class PdfJsTextExtractor implements PdfTextExtractor {
    private readonly loader;
    constructor(loader?: PdfJsLoader);
    extract(buf: Buffer): Promise<string>;
}
export declare function extractText(fileType: DocumentFileType, buf: Buffer, pdf: PdfTextExtractor): Promise<string>;
