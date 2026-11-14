import { Dna } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BuiltinPlugin, PluginHost } from "../../types";
import { VENDOR } from "../../vendor";
import { dataUrlToCanvas, fitPng, trimCanvas } from "../raster";

/* Minimal typing of the Mol* viewer build (molstar/build/viewer/molstar.js). */
interface MolstarViewer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugin: any;
  loadPdb(id: string): Promise<unknown>;
  loadAlphaFoldDb(id: string): Promise<unknown>;
  loadStructureFromUrl(url: string, format?: string, isBinary?: boolean): Promise<unknown>;
  dispose(): void;
}
interface MolstarGlobal {
  Viewer: { create(target: HTMLElement, options: Record<string, unknown>): Promise<MolstarViewer> };
}

type Source = "pdb" | "afdb" | "file";
const STYLES = [
  ["illustrative", "Illustrative (outlined)"],
  ["polymer-cartoon", "Cartoon"],
  ["coarse-surface", "Surface"],
  ["atomic-detail", "Atomic detail"],
] as const;

const PDB_ID = /^[0-9][A-Za-z0-9]{3}$|^pdb_[0-9]{4}[A-Za-z0-9]{4}$/i;
const UNIPROT = /^[A-Z0-9]{6,10}$/i;

function creditFor(source: Source, id: string, fileName: string) {
  const molstar = "Rendered with Mol* (Sehnal et al., Nucleic Acids Res. 2021).";
  if (source === "pdb") return `Structure: PDB ${id.toUpperCase()} (RCSB Protein Data Bank, rcsb.org). ${molstar}`;
  if (source === "afdb") return `Structure: AlphaFold DB model ${id.toUpperCase()} (Jumper et al. 2021; Varadi et al. 2024), CC BY 4.0. ${molstar}`;
  return `Structure: ${fileName}. ${molstar}`;
}

function ProteinPanel({ host, close }: { host: PluginHost; close: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MolstarViewer | null>(null);
  const [status, setStatus] = useState("Loading the Mol* viewer…");
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState<{ source: Source; id: string; file: string } | null>(null);
  const [source, setSource] = useState<Source>("pdb");
  const [id, setId] = useState(() => host.storage.get<string>("lastId") ?? "1TUP");
  const [style, setStyle] = useState<string>("illustrative");
  const [outline, setOutline] = useState(true);
  const [transparent, setTransparent] = useState(true);
  const [size, setSize] = useState(1600);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    host.loadStylesheet(VENDOR.molstar.style);
    host.loadScript(VENDOR.molstar.script, VENDOR.molstar.global)
      .then(async () => {
        const molstar = (window as unknown as { molstar: MolstarGlobal }).molstar;
        if (!hostRef.current || disposed) return;
        const viewer = await molstar.Viewer.create(hostRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: true,
          layoutShowRemoteState: false,
          layoutShowSequence: false,
          layoutShowLog: false,
          layoutShowLeftPanel: false,
          collapseLeftPanel: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
          viewportShowAnimation: false,
          pdbProvider: "rcsb",
          emdbProvider: "rcsb",
        });
        if (disposed) { viewer.dispose(); return; }
        viewerRef.current = viewer;
        setReady(true);
        setStatus("Enter a PDB ID (e.g. 1TUP), an AlphaFold UniProt ID (e.g. P04637) or upload a structure file.");
      })
      .catch((error: Error) => setStatus(`${error.message}. The protein viewer needs an internet connection the first time.`));
    return () => {
      disposed = true;
      try { viewerRef.current?.dispose(); } catch { /* ignore */ }
      viewerRef.current = null;
    };
  }, [host]);

  const applyLook = async (preset = style, withOutline = outline) => {
    const plugin = viewerRef.current?.plugin;
    if (!plugin) return;
    try {
      const structures = plugin.managers?.structure?.hierarchy?.current?.structures ?? [];
      const providers: Array<{ id: string }> = plugin.builders?.structure?.representation?.providers ?? [];
      const provider = providers.find((p) => p.id === preset);
      if (provider && structures.length) await plugin.managers.structure.component.applyPreset(structures, provider);
    } catch {
      setStatus("Style could not be switched automatically — use the Mol* controls on the right (Components → Preset).");
    }
    try {
      plugin.canvas3d?.setProps({
        postprocessing: {
          outline: withOutline
            ? { name: "on", params: { scale: 1, threshold: 0.33, color: 0x000000, includeTransparent: true } }
            : { name: "off", params: {} },
        },
      });
    } catch { /* outline is cosmetic */ }
  };

  const load = async (file?: File) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const value = id.trim();
    if (!file && source === "pdb" && !PDB_ID.test(value)) { setStatus("A PDB ID has 4 characters, e.g. 1TUP or 6VXX."); return; }
    if (!file && source === "afdb" && !UNIPROT.test(value)) { setStatus("Enter a UniProt accession, e.g. P04637."); return; }
    setBusy(true);
    setStatus(file ? `Loading ${file.name}…` : `Downloading ${value.toUpperCase()}…`);
    try {
      await viewer.plugin.clear();
      if (file) {
        const lower = file.name.toLowerCase();
        const format = lower.endsWith(".bcif") ? "mmcif" : /\.(cif|mmcif)$/.test(lower) ? "mmcif" : "pdb";
        const url = URL.createObjectURL(file);
        try { await viewer.loadStructureFromUrl(url, format, lower.endsWith(".bcif")); } finally { URL.revokeObjectURL(url); }
        setLoaded({ source: "file", id: "", file: file.name });
      } else if (source === "pdb") {
        await viewer.loadPdb(value.toLowerCase());
        setLoaded({ source, id: value, file: "" });
      } else {
        await viewer.loadAlphaFoldDb(value.toUpperCase());
        setLoaded({ source, id: value, file: "" });
      }
      host.storage.set("lastId", value);
      await applyLook();
      setStatus("Rotate and zoom with the mouse, then insert. Fine-tune colours in the Mol* controls.");
    } catch (error) {
      setStatus(`Could not load the structure: ${(error as Error).message || "check the ID and your connection"}.`);
    } finally {
      setBusy(false);
    }
  };

  const insert = async () => {
    const viewer = viewerRef.current;
    if (!viewer || !loaded) return;
    setBusy(true);
    setStatus("Rendering…");
    try {
      const helper = viewer.plugin.helpers?.viewportScreenshot;
      let dataUrl: string | undefined;
      if (helper) {
        try {
          helper.behaviors.values.next({
            ...helper.values,
            transparent,
            axes: { name: "off", params: {} },
            resolution: { name: "custom", params: { width: size, height: size } },
          });
        } catch { /* older builds: keep defaults */ }
        dataUrl = await helper.getImageDataUri();
      }
      if (!dataUrl) dataUrl = hostRef.current?.querySelector("canvas")?.toDataURL("image/png");
      if (!dataUrl) throw new Error("The viewer did not return an image.");
      const canvas = transparent ? trimCanvas(await dataUrlToCanvas(dataUrl)) : await dataUrlToCanvas(dataUrl);
      const blob = await fitPng(canvas);
      const name = loaded.source === "file" ? loaded.file : `${loaded.source === "pdb" ? "PDB" : "AlphaFold"} ${loaded.id.toUpperCase()}`;
      await host.insertImage(blob, { name });
      const credit = creditFor(loaded.source, loaded.id, loaded.file);
      try { await navigator.clipboard.writeText(credit); } catch { /* clipboard optional */ }
      host.notify(`Protein inserted. Credit (copied to clipboard): ${credit}`);
      close();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="protein-plugin">
      <div className="protein-controls">
        <label className="field">
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.currentTarget.value as Source)}>
            <option value="pdb">PDB ID (RCSB)</option>
            <option value="afdb">AlphaFold DB (UniProt ID)</option>
            <option value="file">Upload a structure file</option>
          </select>
        </label>
        {source === "file" ? (
          <>
            <button type="button" className="button" disabled={!ready || busy} onClick={() => fileRef.current?.click()}>Choose .pdb / .cif file…</button>
            <input ref={fileRef} type="file" accept=".pdb,.ent,.cif,.mmcif,.bcif" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void load(f); }} />
          </>
        ) : (
          <form className="protein-load" onSubmit={(e) => { e.preventDefault(); void load(); }}>
            <label className="field">
              <span>{source === "pdb" ? "PDB ID" : "UniProt ID"}</span>
              <input value={id} onChange={(e) => setId(e.currentTarget.value)} placeholder={source === "pdb" ? "1TUP" : "P04637"} spellCheck={false} />
            </label>
            <button type="submit" className="button primary" disabled={!ready || busy}>Load</button>
          </form>
        )}
        <label className="field">
          <span>Style</span>
          <select value={style} disabled={!loaded || busy} onChange={(e) => { setStyle(e.currentTarget.value); void applyLook(e.currentTarget.value); }}>
            {STYLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="plugin-check"><input type="checkbox" checked={outline} onChange={(e) => { setOutline(e.currentTarget.checked); void applyLook(style, e.currentTarget.checked); }} /> Black outlines (Protein Imager look)</label>
        <label className="plugin-check"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.currentTarget.checked)} /> Transparent background</label>
        <label className="field">
          <span>Image size</span>
          <select value={size} onChange={(e) => setSize(Number(e.currentTarget.value))}>
            <option value={1000}>1000 px (slides)</option>
            <option value={1600}>1600 px (figures)</option>
            <option value={2400}>2400 px (print)</option>
          </select>
        </label>
        {status && <p className="plugin-hint" role="status">{status}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={close}>Cancel</button>
          <button type="button" className="button primary" disabled={!loaded || busy} onClick={() => void insert()}>Insert into figure</button>
        </div>
      </div>
      <div className="protein-viewer" ref={hostRef} />
    </div>
  );
}

export const proteinPlugin: BuiltinPlugin = {
  kind: "builtin",
  id: "protein",
  name: "Protein structure",
  description: "Render proteins from PDB, AlphaFold or your own files as cartoon, surface or illustrative images.",
  category: "insert",
  Icon: Dna,
  Panel: ProteinPanel,
  wide: true,
  homepage: "https://molstar.org/",
  credits: "Uses Mol* (MIT). Structures from RCSB PDB and AlphaFold DB; cite the entry you use.",
};
