export function hasRepetitiveText(value: string): boolean {
  const tokens = value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (tokens.length < 8) return false;
  for (let width = 1; width <= Math.min(16, Math.floor(tokens.length / 4)); width++) {
    let run = width;
    for (let index = width; index < tokens.length; index++) {
      run = tokens[index] === tokens[index - width] ? run + 1 : width;
      if (run >= width * 4 && run >= 8 && run >= tokens.length * 0.35) return true;
    }
  }
  return false;
}
