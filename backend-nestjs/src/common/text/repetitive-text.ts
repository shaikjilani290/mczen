export function hasRepetitiveText(value: string): boolean {
  const tokens = value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  // Indic decoder loops can be one long token with no spaces between syllables.
  if (tokens.some(token => /\p{L}/u.test(token) && hasRepeatedSequence(Array.from(token), 24))) return true;
  if (tokens.length < 8) return false;
  return hasRepeatedSequence(tokens, 8);
}

function hasRepeatedSequence(parts: readonly string[], minimumRun: number): boolean {
  for (let width = 1; width <= Math.min(16, Math.floor(parts.length / 4)); width++) {
    let run = width;
    for (let index = width; index < parts.length; index++) {
      run = parts[index] === parts[index - width] ? run + 1 : width;
      if (run >= width * 4 && run >= minimumRun && run >= parts.length * 0.35) return true;
    }
  }
  return false;
}
