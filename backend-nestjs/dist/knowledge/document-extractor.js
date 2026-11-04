"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfJsTextExtractor = exports.ExtractionError = exports.MAX_PDF_PAGES = exports.MAX_EXTRACTED_CHARS = exports.MAX_UPLOAD_BYTES = void 0;
exports.safeFilename = safeFilename;
exports.validateUpload = validateUpload;
exports.extractTxt = extractTxt;
exports.readZipEntry = readZipEntry;
exports.extractDocx = extractDocx;
exports.extractText = extractText;
const common_1 = require("@nestjs/common");
const node_zlib_1 = require("node:zlib");
const text_utils_1 = require("./text-utils");
exports.MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
exports.MAX_EXTRACTED_CHARS = 1_000_000;
exports.MAX_PDF_PAGES = 300;
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = { '.pdf': 'pdf', '.docx': 'docx', '.txt': 'txt' };
function safeFilename(name) {
    const base = name.split(/[\\/]/).pop() ?? '';
    const cleaned = base.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
    return cleaned.slice(0, 200) || 'document';
}
function validateUpload(file) {
    if (!file || !Buffer.isBuffer(file.buffer))
        throw new common_1.BadRequestException('A file is required.');
    if (file.buffer.length === 0)
        throw new common_1.BadRequestException('The file is empty.');
    if (file.buffer.length > exports.MAX_UPLOAD_BYTES)
        throw new common_1.PayloadTooLargeException('The file exceeds the 10 MB limit.');
    const displayName = safeFilename(file.originalname ?? '');
    const dot = displayName.lastIndexOf('.');
    const fileType = dot === -1 ? undefined : EXTENSIONS[displayName.slice(dot).toLowerCase()];
    if (!fileType)
        throw new common_1.UnsupportedMediaTypeException('Only PDF, DOCX and TXT files are supported.');
    const buf = file.buffer;
    const ok = (fileType === 'pdf' && buf.subarray(0, 1024).includes('%PDF-')) ||
        (fileType === 'docx' && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) ||
        (fileType === 'txt' && !buf.includes(0));
    if (!ok)
        throw new common_1.UnsupportedMediaTypeException('The file content does not match its type.');
    return { fileType, displayName };
}
class ExtractionError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
    }
}
exports.ExtractionError = ExtractionError;
function extractTxt(buf) {
    let decoded;
    try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    }
    catch {
        throw new ExtractionError('INVALID_ENCODING');
    }
    return decoded;
}
function readZipEntry(buf, wanted) {
    const minEocd = 22;
    let eocd = -1;
    for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 65535); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd === -1)
        throw new ExtractionError('CORRUPT_DOCX');
    const count = buf.readUInt16LE(eocd + 10);
    let offset = buf.readUInt32LE(eocd + 16);
    for (let n = 0; n < count; n++) {
        if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50)
            throw new ExtractionError('CORRUPT_DOCX');
        const method = buf.readUInt16LE(offset + 10);
        const compressedSize = buf.readUInt32LE(offset + 20);
        const uncompressedSize = buf.readUInt32LE(offset + 24);
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        const localOffset = buf.readUInt32LE(offset + 42);
        const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
        offset += 46 + nameLen + extraLen + commentLen;
        if (name !== wanted)
            continue;
        if (uncompressedSize > MAX_ZIP_ENTRY_BYTES)
            throw new ExtractionError('TOO_LARGE');
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50)
            throw new ExtractionError('CORRUPT_DOCX');
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const data = buf.subarray(start, start + compressedSize);
        if (method === 0)
            return Buffer.from(data);
        if (method !== 8)
            throw new ExtractionError('CORRUPT_DOCX');
        try {
            return (0, node_zlib_1.inflateRawSync)(data, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
        }
        catch {
            throw new ExtractionError('CORRUPT_DOCX');
        }
    }
    return undefined;
}
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, ent) => {
        if (ent[0] === '#') {
            const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
        }
        return XML_ENTITIES[ent.toLowerCase()] ?? '';
    });
}
function extractDocx(buf) {
    const xml = readZipEntry(buf, 'word/document.xml')?.toString('utf8');
    if (xml === undefined)
        throw new ExtractionError('CORRUPT_DOCX');
    const withBreaks = xml
        .replace(/<w:tab\s*\/>/g, '\t')
        .replace(/<w:br\s*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n\n');
    const out = withBreaks.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (m, t) => (t === undefined ? '' : decodeXml(t)));
    return out;
}
const loadPdfJs = () => {
    const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
    return import(specifier);
};
class PdfJsTextExtractor {
    loader;
    constructor(loader = loadPdfJs) {
        this.loader = loader;
    }
    async extract(buf) {
        let pdfjs;
        try {
            pdfjs = await this.loader();
        }
        catch {
            throw new ExtractionError('PDF_ENGINE_UNAVAILABLE');
        }
        let doc;
        try {
            doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
        }
        catch {
            throw new ExtractionError('CORRUPT_PDF');
        }
        try {
            if (doc.numPages > exports.MAX_PDF_PAGES)
                throw new ExtractionError('TOO_MANY_PAGES');
            const pages = [];
            let total = 0;
            for (let p = 1; p <= doc.numPages; p++) {
                const page = await doc.getPage(p);
                const content = await page.getTextContent();
                const line = content.items.map((item) => (typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
                total += line.length;
                if (total > exports.MAX_EXTRACTED_CHARS)
                    throw new ExtractionError('TOO_LARGE');
                pages.push(line);
            }
            return pages.join('\n\n');
        }
        finally {
            await doc.destroy?.();
        }
    }
}
exports.PdfJsTextExtractor = PdfJsTextExtractor;
async function extractText(fileType, buf, pdf) {
    const raw = fileType === 'txt' ? extractTxt(buf) : fileType === 'docx' ? extractDocx(buf) : await pdf.extract(buf);
    const clean = (0, text_utils_1.sanitizeText)(raw);
    if (clean.length > exports.MAX_EXTRACTED_CHARS)
        throw new ExtractionError('TOO_LARGE');
    if (clean.length === 0)
        throw new ExtractionError('NO_TEXT');
    return clean;
}
//# sourceMappingURL=document-extractor.js.map