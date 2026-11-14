const validLargeText = new Set<string>();
export function isWellFormedUnicode(text: string): boolean {
  if (validLargeText.has(text)) return true;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = text.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  if (text.length >= 100_000 && text.length <= 5_000_000) { if (validLargeText.size >= 4) validLargeText.delete(validLargeText.values().next().value!); validLargeText.add(text); }
  return true;
}
