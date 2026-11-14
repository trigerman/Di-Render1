import { FolderOpen, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { sanitizeSvg } from "../../../domain/assets/sanitize";
import type { BuiltinPlugin, PluginHost, PluginLicense } from "../../types";
import { deriveMeta, entriesFromDrop, expandEntries, type Entry } from "./importPipeline";
import { LICENSES, SOURCE_PRESETS } from "./presets";
import { clearAll, loadIndex, loadPayloads, removeItems, saveItems, type LibraryItem, type Payload } from "./store";

const PAGE = 120;
const MAX_IMAGE = 4_000_000;

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

function MyLibraryPanel({ host, close }: { host: PluginHost; close: () => void }) {
  const [index, setIndex] = useState<LibraryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [preset, setPreset] = useState(() => host.storage.get<string>("preset") ?? "bioicons");
  const [forcedCategory, setForcedCategory] = useState("");
  const [progress, setProgress] = useState("");
  const [dragging, setDragging] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const pack = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => { void loadIndex().then(setIndex); }, []);
  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const categories = useMemo(() => [...new Set(index.map((i) => i.category))].sort(), [index]);
  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return index.filter((item) => (category === "all" || item.category === category) &&
      words.every((w) => `${item.name} ${item.category} ${item.author} ${item.provider}`.toLowerCase().includes(w)));
  }, [index, query, category]);
  const shown = visible.slice(0, limit);

  // Load thumbnails for the visible page only.
  useEffect(() => {
    const missing = shown.filter((item) => !thumbs[item.id]).map((item) => item.id);
    if (!missing.length) return;
    let active = true;
    void loadPayloads(missing).then((payloads) => {
      if (!active) return;
      const next: Record<string, string> = {};
      payloads.forEach((payload, i) => {
        if (payload === undefined) return;
        if (typeof payload === "string") next[missing[i]!] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload)}`;
        else { const url = URL.createObjectURL(payload); objectUrls.current.push(url); next[missing[i]!] = url; }
      });
      setThumbs((current) => ({ ...current, ...next }));
    });
    return () => { active = false; };
  }, [shown, thumbs]);

  const importEntries = async (raw: Entry[]) => {
    host.storage.set("preset", preset);
    const source = SOURCE_PRESETS[preset] ?? SOURCE_PRESETS.unknown!;
    setProgress("Reading files…");
    const entries = await expandEntries(raw, setProgress);
    const added: Array<[LibraryItem, Payload]> = [];
    const reasons = new Map<string, number>();
    const reject = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    for (let k = 0; k < entries.length; k++) {
      const entry = entries[k]!;
      if (k % 25 === 0) setProgress(`Checking ${k + 1} of ${entries.length}…`);
      const meta = deriveMeta(entry.path);
      const license: PluginLicense | undefined = (meta.licenseFolder && LICENSES[meta.licenseFolder]) || source.license;
      const item: LibraryItem = {
        id: globalThis.crypto.randomUUID(),
        name: meta.name.slice(0, 200),
        category: (forcedCategory.trim() || meta.category).slice(0, 120),
        provider: source.provider,
        author: meta.author,
        license,
        attribution: source.credit(meta.name, meta.author, license),
        kind: "svg",
        added: new Date().toISOString(),
      };
      try {
        if (/\.svg$/i.test(entry.path)) {
          const text = await entry.file.text();
          added.push([item, sanitizeSvg(text).svg]);
        } else {
          if (entry.file.size > MAX_IMAGE) { reject("larger than 4 MB"); continue; }
          const type = /\.png$/i.test(entry.path) ? "image/png" : "image/jpeg";
          added.push([{ ...item, kind: "image" }, new Blob([await entry.file.arrayBuffer()], { type })]);
        }
      } catch (error) {
        reject((error as Error).message.replace(/\.$/, "").slice(0, 80));
      }
    }
    const next = [...index, ...added.map(([item]) => item)];
    await saveItems(next, added);
    setIndex(next);
    const skipped = [...reasons.values()].reduce((a, b) => a + b, 0);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([r, n]) => `${n}× ${r}`).join("; ");
    setProgress(`Imported ${added.length} item${added.length === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped} the editor can't use (${top})` : ""}.`);
  };

  const pick = (input: HTMLInputElement | null, folderMode = false) => {
    const list = [...(input?.files ?? [])];
    if (input) input.value = "";
    if (list.length) void importEntries(list.map((file) => ({ path: folderMode ? file.webkitRelativePath || file.name : file.name, file })));
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void importEntries(await entriesFromDrop(event.dataTransfer));
  };

  const insert = async (item: LibraryItem) => {
    const [payload] = await loadPayloads([item.id]);
    if (payload === undefined) { setProgress("This item is missing from browser storage."); return; }
    try {
      if (typeof payload === "string") {
        await host.insertSvg(payload, {
          title: item.name, provider: item.provider, category: item.category, creator: item.author || item.provider,
          license: item.license, attribution: item.attribution, keywords: [item.name.toLowerCase(), item.category.toLowerCase()],
        });
      } else {
        await host.insertImage(payload, { name: item.name });
        if (item.license?.attributionRequired) host.notify(`Credit: ${item.attribution}`);
      }
    } catch (error) {
      setProgress((error as Error).message);
    }
  };

  const remove = async (ids: string[]) => {
    const next = index.filter((item) => !ids.includes(item.id));
    await removeItems(next, ids);
    setIndex(next);
  };

  const exportPack = async () => {
    setProgress("Preparing pack…");
    const payloads = await loadPayloads(index.map((i) => i.id));
    const items = await Promise.all(index.map(async (item, i) => {
      const p = payloads[i];
      return { ...item, svg: typeof p === "string" ? p : undefined, dataUrl: p instanceof Blob ? await blobToDataUrl(p) : undefined };
    }));
    download("di-render-library.json", new Blob([JSON.stringify({ app: "Di-Render", kind: "library-pack", version: 1, items })], { type: "application/json" }));
    setProgress(`Exported ${items.length} items.`);
  };

  const importPack = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as { kind?: string; items?: Array<LibraryItem & { svg?: string; dataUrl?: string }> };
      if (data.kind !== "library-pack" || !Array.isArray(data.items)) throw new Error("Not a Di-Render library pack.");
      const added: Array<[LibraryItem, Payload]> = [];
      for (const raw of data.items) {
        const { svg, dataUrl, ...meta } = raw;
        const item = { ...meta, id: globalThis.crypto.randomUUID() };
        try {
          if (svg) added.push([item, sanitizeSvg(svg).svg]);
          else if (dataUrl?.startsWith("data:image/")) added.push([item, await (await fetch(dataUrl)).blob()]);
        } catch { /* skip invalid items */ }
      }
      const next = [...index, ...added.map(([i]) => i)];
      await saveItems(next, added);
      setIndex(next);
      setProgress(`Added ${added.length} items from the pack.`);
    } catch (error) {
      setProgress((error as Error).message);
    }
  };

  const source = SOURCE_PRESETS[preset];
  return (
    <div className={`plugin-form library-plugin${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => void onDrop(e)}>
      <section className="library-import">
        <div className="dialog-fields two-columns">
          <label className="field">
            <span>Where are the files from?</span>
            <select value={preset} onChange={(e) => setPreset(e.currentTarget.value)}>
              {Object.entries(SOURCE_PRESETS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Category (blank = folder names)</span>
            <input value={forcedCategory} onChange={(e) => setForcedCategory(e.currentTarget.value)} placeholder="auto" />
          </label>
        </div>
        {source?.hint && <p className="plugin-hint">{source.hint}{source.url && <> · <a href={source.url} target="_blank" rel="noreferrer">Open site</a></>}</p>}
        <div className="library-buttons">
          <button type="button" className="button primary" onClick={() => files.current?.click()}><Upload /> Files or archives…</button>
          <button type="button" className="button" onClick={() => folder.current?.click()}><FolderOpen /> A folder…</button>
          <span className="plugin-hint">or drop files, folders, .zip, .tgz or .pptx here</span>
        </div>
        <input ref={files} type="file" hidden multiple accept=".svg,.png,.jpg,.jpeg,.zip,.pptx,.tgz,.gz,.tar" onChange={(e) => pick(e.currentTarget)} />
        <input ref={folder} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} onChange={(e) => pick(e.currentTarget, true)} />
        {progress && <p className="notice info" role="status">{progress}</p>}
      </section>

      <section className="library-browse">
        <div className="library-filters">
          <input type="search" placeholder={`Search ${index.length} items`} value={query} onChange={(e) => { setQuery(e.currentTarget.value); setLimit(PAGE); }} aria-label="Search my library" />
          <select value={category} onChange={(e) => { setCategory(e.currentTarget.value); setLimit(PAGE); }} aria-label="Category">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {index.length === 0 ? (
          <p className="plugins-empty">Your library is empty. Imported icons stay in this browser; export a pack to back them up.</p>
        ) : (
          <div className="library-grid">
            {shown.map((item) => (
              <div key={item.id} className="library-thumb" title={`${item.name}\n${item.provider}${item.license ? ` · ${item.license.id}` : ""}`}>
                <button type="button" onClick={() => void insert(item)} aria-label={`Insert ${item.name}`}>
                  {thumbs[item.id] ? <img src={thumbs[item.id]} alt="" loading="lazy" /> : <span className="library-thumb-placeholder" />}
                </button>
                <button type="button" className="library-remove" aria-label={`Remove ${item.name}`} onClick={() => void remove([item.id])}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
        {visible.length > limit && <button type="button" className="button quiet" onClick={() => setLimit((n) => n + PAGE)}>Show more ({visible.length - limit} left)</button>}
      </section>

      <div className="dialog-actions library-footer">
        <button type="button" className="button quiet" disabled={!index.length} onClick={() => void exportPack()}>Export pack</button>
        <button type="button" className="button quiet" onClick={() => pack.current?.click()}>Import pack</button>
        {category !== "all" && <button type="button" className="button danger-outline" onClick={() => void remove(index.filter((i) => i.category === category).map((i) => i.id))}>Delete “{category}”</button>}
        {index.length > 0 && category === "all" && <button type="button" className="button danger-outline" onClick={() => { if (window.confirm(`Delete all ${index.length} imported items?`)) void clearAll(index).then(() => setIndex([])); }}>Delete all</button>}
        <button type="button" className="button" onClick={close}>Done</button>
        <input ref={pack} type="file" hidden accept=".json,application/json" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void importPack(f); }} />
      </div>
    </div>
  );
}

export const myLibraryPlugin: BuiltinPlugin = {
  kind: "builtin",
  id: "my-library",
  name: "My library & icon import",
  description: "Bulk-import SVG/PNG icons, folders, ZIP, TGZ or PowerPoint kits with licence tracking.",
  category: "library",
  Icon: FolderOpen,
  Panel: MyLibraryPanel,
  wide: true,
  credits: "Icons keep the licence you choose; it appears in the Licensing tab of every figure that uses them.",
};
