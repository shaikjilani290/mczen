"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHUNK_OVERLAP = exports.CHUNK_MAX = exports.CHUNK_TARGET = exports.MAX_CHUNKS_PER_ITEM = void 0;
exports.sanitizeText = sanitizeText;
exports.tokenize = tokenize;
exports.chunkText = chunkText;
exports.slugify = slugify;
exports.MAX_CHUNKS_PER_ITEM = 2000;
exports.CHUNK_TARGET = 900;
exports.CHUNK_MAX = 1400;
exports.CHUNK_OVERLAP = 120;
function sanitizeText(input) {
    return input
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'are', 'was', 'with', 'what', 'how', 'can', 'you', 'your', 'about', 'does', 'this', 'that',
    'have', 'has', 'from', 'tell', 'please', 'give', 'any', 'some', 'when', 'why', 'who', 'is', 'of', 'to', 'in', 'on', 'a', 'an', 'my', 'me', 'i',
]);
function tokenize(text) {
    const tokens = text
        .normalize('NFC')
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
    return [...new Set(tokens)].slice(0, 32);
}
function splitSentences(paragraph) {
    return paragraph.split(/(?<=[.!?\u0964\u0965])\s+/u).filter((part) => part.length > 0);
}
function hardSplit(text, max) {
    const parts = [];
    for (let index = 0; index < text.length; index += max)
        parts.push(text.slice(index, index + max));
    return parts;
}
function tailOverlap(chunk, overlap) {
    if (chunk.length <= overlap)
        return '';
    const tail = chunk.slice(chunk.length - overlap);
    const space = tail.search(/\s/u);
    return space === -1 ? '' : tail.slice(space + 1);
}
function chunkText(text, options = {}) {
    const target = options.target ?? exports.CHUNK_TARGET;
    const max = options.max ?? exports.CHUNK_MAX;
    const overlap = options.overlap ?? exports.CHUNK_OVERLAP;
    const clean = sanitizeText(text);
    if (!clean)
        return [];
    const units = [];
    for (const paragraph of clean.split(/\n{2,}/)) {
        const trimmed = paragraph.trim();
        if (!trimmed)
            continue;
        if (trimmed.length <= target) {
            units.push(trimmed);
            continue;
        }
        for (const sentence of splitSentences(trimmed)) {
            if (sentence.length <= max)
                units.push(sentence);
            else
                units.push(...hardSplit(sentence, max));
        }
    }
    const chunks = [];
    let current = '';
    for (const unit of units) {
        const joined = current ? `${current}\n${unit}` : unit;
        if (current && joined.length > target) {
            chunks.push(current);
            const carry = tailOverlap(current, overlap);
            current = carry ? `${carry}\n${unit}` : unit;
            if (current.length > max)
                current = unit;
        }
        else {
            current = joined;
        }
        if (chunks.length > exports.MAX_CHUNKS_PER_ITEM)
            throw new RangeError('TOO_MANY_CHUNKS');
    }
    if (current)
        chunks.push(current);
    if (chunks.length > exports.MAX_CHUNKS_PER_ITEM)
        throw new RangeError('TOO_MANY_CHUNKS');
    return chunks;
}
function slugify(name) {
    const slug = name
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
    return slug || 'category';
}
//# sourceMappingURL=text-utils.js.map