import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';
import { sanitizeText } from './text-utils';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EXTRACTED_CHARS = 1_000_000;
export const MAX_PDF_PAGES = 300;
const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;

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

const EXTENSIONS: Record<string, DocumentFileType> = { '.pdf': 'pdf', '.docx': 'docx', '.txt': 'txt' };

/** Strips path parts and control characters; the result is only a label, never a filesystem path. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 200) || 'document';
}

/**
 * Extension whitelist AND content signature. The client-declared MIME type is
 * ignored because it is attacker controlled.
 */
export function validateUpload(file: UploadedFileLike | undefined): ValidatedUpload {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new BadRequestException('A file is required.');
  if (file.buffer.length === 0) throw new BadRequestException('The file is empty.');
  if (file.buffer.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('The file exceeds the 10 MB limit.');
  const displayName = safeFilename(file.originalname ?? '');
  const dot = displayName.lastIndexOf('.');
  const fileType = dot === -1 ? undefined : EXTENSIONS[displayName.slice(dot).toLowerCase()];
  if (!fileType) throw new UnsupportedMediaTypeException('Only PDF, DOCX and TXT files are supported.');

  const buf = file.buffer;
  const ok =
    (fileType === 'pdf' && buf.subarray(0, 1024).includes('%PDF-')) ||
    (fileType === 'docx' && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) ||
    (fileType === 'txt' && !buf.includes(0));
  if (!ok) throw new UnsupportedMediaTypeException('The file content does not match its type.');
  return { fileType, displayName };
}

export class ExtractionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function extractTxt(buf: Buffer): string {
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new ExtractionError('INVALID_ENCODING');
  }
  return decoded;
}

/** Minimal zip reader: locates one entry via the central directory and inflates it with a size cap (zip-bomb guard). */
export function readZipEntry(buf: Buffer, wanted: string): Buffer | undefined {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new ExtractionError('CORRUPT_DOCX');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new ExtractionError('CORRUPT_DOCX');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new ExtractionError('TOO_LARGE');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ExtractionError('CORRUPT_DOCX');
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method !== 8) throw new ExtractionError('CORRUPT_DOCX');
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
    } catch {
      throw new ExtractionError('CORRUPT_DOCX');
    }
  }
  return undefined;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[ent.toLowerCase()] ?? '';
  });
}

export function extractDocx(buf: Buffer): string {
  const xml = readZipEntry(buf, 'word/document.xml')?.toString('utf8');
  if (xml === undefined) throw new ExtractionError('CORRUPT_DOCX');
  const withBreaks = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n\n');
  const out = withBreaks.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (m, t: string | undefined) => (t === undefined ? '' : decodeXml(t)));
  return out;
}

export interface PdfTextExtractor {
  extract(buf: Buffer): Promise<string>;
}

export type PdfJsLoader = () => Promise<any>;

const loadPdfJs: PdfJsLoader = () => {
  const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
  return import(specifier);
};

/** pdfjs-dist is ESM-only; a variable specifier keeps TypeScript from resolving it at compile time. */
export class PdfJsTextExtractor implements PdfTextExtractor {
  constructor(private readonly loader: PdfJsLoader = loadPdfJs) {}

  async extract(buf: Buffer): Promise<string> {
    let pdfjs: any;
    try {
      pdfjs = await this.loader();
    } catch {
      throw new ExtractionError('PDF_ENGINE_UNAVAILABLE');
    }
    let doc: any;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    } catch {
      throw new ExtractionError('CORRUPT_PDF');
    }
    try {
      if (doc.numPages > MAX_PDF_PAGES) throw new ExtractionError('TOO_MANY_PAGES');
      const pages: string[] = [];
      let total = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const line = content.items.map((item: any) => (typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('');
        total += line.length;
        if (total > MAX_EXTRACTED_CHARS) throw new ExtractionError('TOO_LARGE');
        pages.push(line);
      }
      return pages.join('\n\n');
    } finally {
      await doc.destroy?.();
    }
  }
}

export async function extractText(fileType: DocumentFileType, buf: Buffer, pdf: PdfTextExtractor): Promise<string> {
  const raw = fileType === 'txt' ? extractTxt(buf) : fileType === 'docx' ? extractDocx(buf) : await pdf.extract(buf);
  const clean = sanitizeText(raw);
  if (clean.length > MAX_EXTRACTED_CHARS) throw new ExtractionError('TOO_LARGE');
  if (clean.length === 0) throw new ExtractionError('NO_TEXT');
  return clean;
}
