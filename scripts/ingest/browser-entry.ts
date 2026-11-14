// Maintainer ingestion only: runs the app's own normalizer, strict sanitizer and
// fingerprint in a real browser DOM so new library packs meet the same grammar.
import { normalizeLibrarySvg } from "../normalize-library-svg.mjs";
import { sanitizeSvg } from "../../app/src/domain/assets/strictSvg";
import { svgFingerprint } from "../../app/src/domain/assets/svgFingerprint";
import { loadDrawingParts } from "../../app/src/editor/svgDrawing";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** Drops non-rendering authoring metadata only: foreign-namespace elements
 * (Inkscape/Sodipodi/RDF/Illustrator), their attributes, and redundant namespace
 * declarations. Geometry and paint are never touched. */
function stripEditorMetadata(raw: string): string | null {
  if (/<!ENTITY/i.test(raw)) return null;
  const text = raw.replace(/<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>[]*>/i, "").replace(/<!--[\s\S]*?-->/g, "");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.namespaceURI !== SVG_NS) return null;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (child.namespaceURI !== SVG_NS || child.localName === "metadata") child.remove();
      else walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const ns = attr.namespaceURI;
      if (ns === XMLNS_NS) { if (attr.value !== XLINK_NS) el.removeAttributeNode(attr); continue; }
      if (ns && ns !== XLINK_NS && ns !== "http://www.w3.org/XML/1998/namespace") el.removeAttributeNode(attr);
      else if (attr.name === "xml:space") el.removeAttributeNode(attr);
    }
  };
  walk(doc.documentElement);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

async function run(raw: string) {
  const normalized = normalizeLibrarySvg(raw) as { svg: string; changes: string[] };
  const safe = sanitizeSvg(normalized.svg);
  // The canvas engine must be able to build the drawing, not just the sanitizer accept it.
  const parts = await loadDrawingParts(safe.svg);
  if (!parts.length) throw new Error("No supported visible geometry");
  return { ok: true, svg: normalized.svg, changes: normalized.changes, fingerprint: svgFingerprint(safe.svg) };
}

(window as unknown as { ingest: (raw: string) => Promise<unknown> }).ingest = async (raw: string) => {
  try { return await run(raw); } catch (first) {
    const cleaned = stripEditorMetadata(raw);
    if (cleaned && cleaned !== raw) {
      try {
        const result = await run(cleaned);
        return { ...result, changes: [...new Set([...result.changes, "Non-rendering editor metadata removed"])].sort() };
      } catch { /* report the original reason below */ }
    }
    return { ok: false, error: String((first as Error)?.message ?? first) };
  }
};
