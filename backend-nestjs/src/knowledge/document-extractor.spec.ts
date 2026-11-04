import {
  extractDocx, extractText, extractTxt, ExtractionError, MAX_UPLOAD_BYTES, PdfJsTextExtractor, readZipEntry, safeFilename, validateUpload,
} from './document-extractor';
import { buildZip, docxWith, simplePdf } from './test-fixtures';

const file = (name: string, buffer: Buffer) => ({ originalname: name, size: buffer.length, buffer });

describe('upload validation', () => {
  it('accepts matching extension + signature for txt, docx and pdf', () => {
    expect(validateUpload(file('notes.TXT', Buffer.from('hello')))).toEqual({ fileType: 'txt', displayName: 'notes.TXT' });
    expect(validateUpload(file('a.docx', docxWith(['x']))).fileType).toBe('docx');
    expect(validateUpload(file('a.pdf', simplePdf('x'))).fileType).toBe('pdf');
  });

  it('rejects wrong extensions, spoofed content, empty and oversized files', () => {
    expect(() => validateUpload(file('a.exe', Buffer.from('MZ')))).toThrow('Only PDF, DOCX and TXT');
    expect(() => validateUpload(file('a.pdf', Buffer.from('not a pdf')))).toThrow('does not match');
    expect(() => validateUpload(file('a.docx', Buffer.from('plain text')))).toThrow('does not match');
    expect(() => validateUpload(file('a.txt', Buffer.from([0x68, 0x00, 0x69])))).toThrow('does not match');
    expect(() => validateUpload(file('a.txt', Buffer.alloc(0)))).toThrow('empty');
    expect(() => validateUpload(file('a.txt', Buffer.alloc(MAX_UPLOAD_BYTES + 1, 97)))).toThrow('10 MB');
    expect(() => validateUpload(undefined)).toThrow('required');
    expect(() => validateUpload(file('noext', Buffer.from('x')))).toThrow();
  });

  it('reduces client filenames to a harmless label', () => {
    expect(safeFilename('..\\..\\etc/passwd.txt')).toBe('passwd.txt');
    expect(safeFilename('a\u0000b<c>.txt')).toBe('abc.txt');
    expect(safeFilename('')).toBe('document');
  });
});

describe('text extraction', () => {
  it('extracts Hindi and Telugu TXT and rejects invalid UTF-8', () => {
    const text = 'नींद ఆరోగ్యం sleep';
    expect(extractTxt(Buffer.from(text, 'utf8'))).toBe(text);
    expect(() => extractTxt(Buffer.from([0xff, 0xfe, 0xfd]))).toThrow(ExtractionError);
  });

  it('extracts DOCX paragraphs (deflated and stored), decoding XML entities and Indic text', () => {
    const out = extractDocx(docxWith(['నిద్ర &amp; ఆరోగ్యం', 'नींद &lt;ज़रूरी&gt;']));
    expect(out).toContain('నిద్ర & ఆరోగ్యం');
    expect(out).toContain('नींद <ज़रूरी>');
    expect(extractDocx(docxWith(['plain'], false))).toContain('plain');
  });

  it('rejects damaged DOCX and DOCX without document.xml', () => {
    expect(() => extractDocx(Buffer.from('PK\x03\x04garbage'))).toThrow(ExtractionError);
    expect(() => extractDocx(buildZip({ 'other.xml': 'x' }))).toThrow(ExtractionError);
  });

  it('caps inflated size (zip-bomb guard)', () => {
    const bomb = buildZip({ 'word/document.xml': Buffer.alloc(25 * 1024 * 1024, 97) }, true);
    expect(() => readZipEntry(bomb, 'word/document.xml')).toThrow(ExtractionError);
  });

  it('extractText sanitises and rejects empty results', async () => {
    const pdf = { extract: async () => '' };
    await expect(extractText('txt', Buffer.from('  \n '), pdf)).rejects.toMatchObject({ code: 'NO_TEXT' });
    await expect(extractText('txt', Buffer.from('a\u0000b'), pdf)).resolves.toBe('ab');
  });

  // Jest compiles import() to require(), which cannot load the ESM-only pdf.js; the real engine is
  // verified against the compiled build (see the Phase 6E report), so here the engine is faked.
  const fakeEngine = (pages: string[][], fail = false) => async () => ({
    getDocument: () => ({
      promise: fail
        ? Promise.reject(new Error('bad pdf'))
        : Promise.resolve({
            numPages: pages.length,
            getPage: async (n: number) => ({ getTextContent: async () => ({ items: pages[n - 1].map((str) => ({ str, hasEOL: false })) }) }),
            destroy: async () => undefined,
          }),
    }),
  });

  it('joins page text from the PDF engine', async () => {
    const out = await new PdfJsTextExtractor(fakeEngine([['Hydration', 'helps'], ['నిద్ర']])).extract(Buffer.from('%PDF-'));
    expect(out).toContain('Hydration helps');
    expect(out).toContain('నిద్ర');
  });

  it('maps engine failures to typed errors and enforces the page cap', async () => {
    await expect(new PdfJsTextExtractor(fakeEngine([], true)).extract(Buffer.from('%PDF-'))).rejects.toMatchObject({ code: 'CORRUPT_PDF' });
    await expect(new PdfJsTextExtractor(async () => { throw new Error('x'); }).extract(Buffer.from('%PDF-'))).rejects.toMatchObject({ code: 'PDF_ENGINE_UNAVAILABLE' });
    await expect(new PdfJsTextExtractor(fakeEngine(Array.from({ length: 301 }, () => ['a']))).extract(Buffer.from('%PDF-'))).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' });
  });
});
