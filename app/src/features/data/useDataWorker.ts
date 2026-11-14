import { useEffect, useRef, useState } from 'react';

/** Each revision owns its worker. Cleanup aborts obsolete parsing/analysis, including dialog close. */
export function useDataWorker<T>(request: unknown, requestKey?: string) {
  const revision = useRef(0), [state, setState] = useState<{ key: string | null; value: T | null; error: string | null; busy: boolean }>({ key: null, value: null, error: null, busy: true });
  const key = requestKey ?? JSON.stringify(request);
  useEffect(() => {
    const current = ++revision.current, worker = new Worker(new URL('../../workers/dataWorker.ts', import.meta.url), { type: 'module' });
    setState({ key, value: null, error: null, busy: true });
    const timeout = setTimeout(() => { if (revision.current === current) setState({key, value:null,error:'The data took too long to read. Reduce the file.',busy:false}); worker.terminate(); }, 60_000);
    worker.onmessage = event => {
      if (revision.current !== current) return;
      clearTimeout(timeout);
      if (event.data?.ok === true) setState({ key, value: event.data.value as T, error: null, busy: false });
      else setState({ key, value: null, error: typeof event.data?.error === 'string' ? event.data.error.slice(0, 500) : 'Unsupported data.', busy: false });
      worker.terminate();
    };
    worker.onerror = () => { clearTimeout(timeout); if (revision.current === current) setState({ key, value: null, error: 'Local data processing failed.', busy: false }); worker.terminate(); };
    worker.postMessage(request);
    return () => { revision.current++; clearTimeout(timeout); worker.terminate(); };
  }, [key]);
  return state.key === key ? state : {key, value:null, error:null, busy:true};
}
