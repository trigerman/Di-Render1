import { Atom } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { BuiltinPlugin, PluginHost } from "../../types";
import { VENDOR } from "../../vendor";
import { svgToPng } from "../raster";
import { COMMON_MOLECULES } from "./molecules";

interface SmilesDrawerGlobal {
  SvgDrawer: new (options: Record<string, unknown>) => { draw(tree: unknown, target: string | SVGElement, theme?: string): void };
  parse(smiles: string, ok: (tree: unknown) => void, fail?: (error: unknown) => void): void;
}

function MoleculePanel({ host, close }: { host: PluginHost; close: () => void }) {
  const svgId = `mol-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [smiles, setSmiles] = useState(() => host.storage.get<string>("last") ?? "CC(=O)Oc1ccccc1C(=O)O");
  const [name, setName] = useState(() => host.storage.get<string>("lastName") ?? "Aspirin");
  const [status, setStatus] = useState("Loading the structure drawer…");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [lib, setLib] = useState<SmilesDrawerGlobal | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    host.loadScript(VENDOR.smilesDrawer.script, VENDOR.smilesDrawer.global)
      .then(() => { if (active) { setLib((window as unknown as { SmilesDrawer: SmilesDrawerGlobal }).SmilesDrawer); setStatus(""); } })
      .catch((error: Error) => active && setStatus(error.message));
    return () => { active = false; };
  }, [host]);

  useEffect(() => {
    const target = svgRef.current;
    if (!lib || !target) return;
    const value = smiles.trim();
    setDrawn(null);
    target.replaceChildren();
    target.removeAttribute("viewBox");
    if (!value) return;
    const timer = window.setTimeout(() => {
      try {
        const drawer = new lib.SvgDrawer({ width: 520, height: 320, bondThickness: 1.2, padding: 14, compactDrawing: false });
        lib.parse(value, (tree) => {
          try {
            drawer.draw(tree, svgId, "light");
            const box = target.getBBox();
            const pad = 6;
            target.setAttribute("viewBox", `${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`);
            const clone = target.cloneNode(true) as SVGSVGElement;
            for (const attr of ["id", "style", "class", "width", "height", "data-smiles"]) clone.removeAttribute(attr);
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            setDrawn(new XMLSerializer().serializeToString(clone));
            setStatus("");
          } catch (error) {
            setStatus(`Could not draw this molecule: ${(error as Error).message}`);
          }
        }, () => setStatus("That SMILES string could not be parsed. Check it and try again."));
      } catch (error) {
        setStatus(`Drawer error: ${(error as Error).message}`);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [lib, smiles, svgId]);

  const insert = async () => {
    if (!drawn) return;
    setBusy(true);
    host.storage.set("last", smiles.trim());
    host.storage.set("lastName", name.trim());
    const title = name.trim() || "Molecule";
    const meta = {
      title,
      provider: "SmilesDrawer",
      description: `${title} drawn from SMILES ${smiles.trim().slice(0, 500)}`,
      keywords: [title.toLowerCase(), "molecule", "smiles", "chemical structure"],
      category: "Molecules",
      creator: "Generated in Di-Render",
      license: { id: "CC0-1.0", name: "Generated structure diagram (no rights reserved)", url: "https://creativecommons.org/publicdomain/zero/1.0/", attributionRequired: false },
      attribution: `${title} structure drawn with SmilesDrawer (Probst & Reymond, J. Chem. Inf. Model. 2018).`,
    };
    try {
      await host.insertSvg(drawn, meta);
      close();
    } catch {
      // The strict SVG grammar can reject some text features: fall back to a crisp PNG.
      try {
        await host.insertImage(await svgToPng(drawn, 4), { name: title });
        host.notify("Inserted as a high-resolution image (this drawing uses SVG features the editor keeps as pixels).");
        close();
      } catch (error) {
        setStatus((error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plugin-form molecule-plugin">
      <div className="dialog-fields two-columns">
        <label className="field">
          <span>Common molecules</span>
          <select value="" onChange={(e) => {
            const pick = COMMON_MOLECULES.find((m) => m[1] === e.currentTarget.value);
            if (pick) { setName(pick[0]); setSmiles(pick[1]); }
          }}>
            <option value="">Choose…</option>
            {COMMON_MOLECULES.map(([label, value]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="e.g. Imatinib" />
        </label>
      </div>
      <label className="field">
        <span>SMILES</span>
        <input value={smiles} onChange={(e) => setSmiles(e.currentTarget.value)} spellCheck={false} placeholder="Paste SMILES, e.g. from PubChem" />
      </label>
      <p className="plugin-hint">Get any compound's SMILES from <a href="https://pubchem.ncbi.nlm.nih.gov/" target="_blank" rel="noreferrer">PubChem</a> (Names and Identifiers → SMILES).</p>
      <div className="molecule-preview"><svg ref={svgRef} id={svgId} xmlns="http://www.w3.org/2000/svg" /></div>
      {status && <p className="notice info" role="status">{status}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={close}>Cancel</button>
        <button type="button" className="button primary" disabled={!drawn || busy} onClick={() => void insert()}>Insert molecule</button>
      </div>
    </div>
  );
}

export const moleculePlugin: BuiltinPlugin = {
  kind: "builtin",
  id: "molecule",
  name: "Molecule from SMILES",
  description: "Draw chemical structures from SMILES as editable vectors.",
  category: "insert",
  Icon: Atom,
  Panel: MoleculePanel,
  homepage: "https://github.com/reymond-group/smilesDrawer",
  credits: "Uses SmilesDrawer (MIT) by the Reymond group.",
};
