import type { DataSource, Dataset } from '../../domain/data/schema';
import { INPUT_LIMITS, InputError, assertFileSize } from '../../domain/security/input';

/** Decoding and hashing large local files are cancellable and never block the editor thread. */
export function decodeFile(bytes: Uint8Array, fallback?: 'windows-1252', signal?: AbortSignal): Promise<{source:DataSource;encoding:Dataset['origin']['encoding']}> {
  assertFileSize(bytes.byteLength, INPUT_LIMITS.dataSourceBytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/dataWorker.ts', import.meta.url), {type:'module'});
    const finish = () => { clearTimeout(timeout); signal?.removeEventListener('abort', stop); worker.terminate(); };
    const stop = () => { finish(); reject(new InputError('data_cancelled', 'Local data processing was cancelled.')); };
    const timeout = setTimeout(() => { finish(); reject(new InputError('data_timeout', 'The data took too long to read. Reduce the file.')); }, 60_000);
    signal?.addEventListener('abort', stop, {once:true});
    worker.onmessage = event => { finish(); if (event.data?.ok) resolve(event.data.value); else reject(new InputError(event.data?.code ?? 'data_encoding', event.data?.error ?? 'Unsupported data.')); };
    worker.onerror = () => { finish(); reject(new InputError('data_encoding', 'Local data processing failed.')); };
    if (signal?.aborted) { stop(); return; }
    worker.postMessage({kind:'file',bytes,...(fallback ? {fallback} : {})},[bytes.buffer]);
  });
}
