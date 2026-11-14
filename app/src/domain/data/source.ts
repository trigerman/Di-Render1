import { sha256 } from "../assets/svgFingerprint";
import { assertByteLimit, assertFileSize, INPUT_LIMITS, InputError } from "../security/input";
import type { DataSource, Dataset } from "./schema";

import { isWellFormedUnicode } from '../security/unicode';
export { isWellFormedUnicode } from '../security/unicode';

/** Validate before hashing: TextEncoder otherwise aliases lone surrogates to U+FFFD. */
export function assertDataSourceContent(content: string): void {
  assertByteLimit(content, INPUT_LIMITS.dataSourceBytes);
  if (!isWellFormedUnicode(content))
    throw new InputError("invalid_unicode", "Data contains an unpaired Unicode surrogate. Correct the text before importing it.");
  if (content.includes("\0"))
    throw new InputError("binary_data", "Data contains NUL characters and cannot be read as a text table.");
}

/** A decoded input is kept verbatim except for its leading BOM. No provenance lives here. */
export function createDataSource(text: string): DataSource {
  assertDataSourceContent(text);
  const content = text.startsWith("\ufeff") ? text.slice(1) : text;
  return { id: `data-${sha256(content)}`, content };
}

/** Run at the portable-file boundary, rather than on every edit or autosave validation. */
export function verifyDataSourceHashes(sources: readonly DataSource[]): void {
  for (const source of sources) {
    assertDataSourceContent(source.content);
    if (source.id !== `data-${sha256(source.content)}`)
      throw new InputError("data_hash_mismatch", "Imported data does not match its content fingerprint. The project was not opened.");
  }
}

export function decodeDataFile(bytes: Uint8Array, fallback?: 'windows-1252'): { source: DataSource; encoding: Dataset['origin']['encoding'] } {
  assertFileSize(bytes.byteLength, INPUT_LIMITS.dataSourceBytes);
  let encoding: Dataset['origin']['encoding'] = fallback ?? 'utf-8';
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new InputError('data_encoding', 'The file is not valid Unicode. Choose Windows-1252 explicitly if that is its encoding.'); }
  return { source: createDataSource(text), encoding };
}
