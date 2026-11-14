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

/* ---------- PDF → SVG cleanup for PowerPoint kits (pdftocairo output) ---------- */
const XLINK = "http://www.w3.org/1999/xlink";

async function averageColor(href: string): Promise<{ fill: string; opacity: number }> {
  const blob = await (await fetch(href)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < data.length; i += 4) { const al = data[i + 3]!; r += data[i]! * al; g += data[i + 1]! * al; b += data[i + 2]! * al; a += al; }
  const n = data.length / 4;
  if (!a) return { fill: "none", opacity: 0 };
  const hex = (v: number) => Math.round(v / a).toString(16).padStart(2, "0");
  return { fill: `#${hex(r)}${hex(g)}${hex(b)}`, opacity: Math.round((a / n / 255) * 1000) / 1000 };
}

const pct = (v: string) => Math.round(Math.min(100, Math.max(0, parseFloat(v))) * 2.55).toString(16).padStart(2, "0");
const shortColors = (text: string) =>
  text.replace(/rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/g, (_m, r, g, b) => `#${pct(r)}${pct(g)}${pct(b)}`);

/** Inline glyph/image <use> references, replace tiny gradient rasters with solid fills, and crop to content. */
(window as unknown as { pdfSvgClean: (raw: string) => Promise<unknown> }).pdfSvgClean = async (raw: string) => {
  try {
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
    if (doc.querySelector("parsererror")) return { ok: false, error: "parse" };
    const root = doc.documentElement;
    const fills = new Map<string, { fill: string; opacity: number; w: number; h: number; x: number; y: number }>();
    for (const image of Array.from(root.querySelectorAll("image"))) {
      const w = Number(image.getAttribute("width")), h = Number(image.getAttribute("height"));
      if (w > 32 && h > 32) return { ok: false, error: "raster content" };
      const href = image.getAttribute("xlink:href") ?? image.getAttributeNS(XLINK, "href") ?? image.getAttribute("href") ?? "";
      if (!href.startsWith("data:image/")) return { ok: false, error: "external image" };
      fills.set(image.id, { ...(await averageColor(href)), w, h, x: Number(image.getAttribute("x") ?? 0), y: Number(image.getAttribute("y") ?? 0) });
    }
    for (const use of Array.from(root.querySelectorAll("use"))) {
      const ref = (use.getAttribute("xlink:href") ?? use.getAttributeNS(XLINK, "href") ?? use.getAttribute("href") ?? "").replace(/^#/, "");
      const target = ref ? doc.getElementById(ref) : null;
      let replacement: Element;
      if (!target) { use.remove(); continue; }
      if (target.localName === "image") {
        const f = fills.get(ref)!;
        if (f.fill === "none") { use.remove(); continue; }
        replacement = doc.createElementNS(SVG_NS, "rect");
        for (const [k, v] of Object.entries({ x: f.x, y: f.y, width: f.w, height: f.h })) replacement.setAttribute(k, String(v));
        replacement.setAttribute("fill", f.fill);
        if (f.opacity < 0.995) replacement.setAttribute("fill-opacity", String(f.opacity));
      } else {
        replacement = doc.createElementNS(SVG_NS, "g");
        for (const child of Array.from(target.childNodes)) replacement.appendChild(child.cloneNode(true));
      }
      const x = Number(use.getAttribute("x") ?? 0), y = Number(use.getAttribute("y") ?? 0);
      const transform = [use.getAttribute("transform") ?? "", x || y ? `translate(${x} ${y})` : ""].filter(Boolean).join(" ");
      if (transform) replacement.setAttribute("transform", transform);
      for (const attr of Array.from(use.attributes))
        if (!["x", "y", "width", "height", "transform", "href", "xlink:href"].includes(attr.name) && attr.namespaceURI !== XLINK) replacement.setAttribute(attr.name, attr.value);
      use.replaceWith(replacement);
    }
    for (const el of Array.from(root.querySelectorAll("image, symbol"))) el.remove();
    for (const el of Array.from(root.querySelectorAll("defs > g[id^='glyph'], defs > g[id^='source']"))) el.remove();
    // Crop to the drawing's bounds.
    const host = document.createElementNS(SVG_NS, "svg");
    host.setAttribute("style", "position:absolute;left:-99999px;top:0");
    host.setAttribute("viewBox", root.getAttribute("viewBox") ?? "");
    host.setAttribute("width", root.getAttribute("width") ?? "1000");
    host.setAttribute("height", root.getAttribute("height") ?? "1000");
    const wrap = document.createElementNS(SVG_NS, "g");
    for (const child of Array.from(root.childNodes)) wrap.appendChild(document.importNode(child, true));
    host.appendChild(wrap); document.body.appendChild(host);
    // LibreOffice paints a page-sized background even with no fill: drop page-covering shapes.
    const vb = (root.getAttribute("viewBox") ?? "0 0 1000 1000").split(/[\s,]+/).map(Number);
    const pageW = vb[2] ?? 1000, pageH = vb[3] ?? 1000;
    const liveToDoc = new Map<Element, Element>();
    const liveAll = Array.from(wrap.querySelectorAll("path, rect")), docAll = Array.from(root.querySelectorAll("path, rect"));
    liveAll.forEach((el, i) => { if (docAll[i]) liveToDoc.set(el, docAll[i]!); });
    for (const el of liveAll) {
      if (el.closest("clipPath, defs")) continue;
      const b = (el as SVGGraphicsElement).getBBox();
      if (b.width >= pageW * 0.9 && b.height >= pageH * 0.9) { liveToDoc.get(el)?.remove(); el.remove(); }
    }
    const box = wrap.getBBox();
    host.remove();
    if (box.width < 4 || box.height < 4) return { ok: false, error: "too small" };
    const pad = Math.max(box.width, box.height) * 0.02;
    root.setAttribute("viewBox", `${(box.x - pad).toFixed(2)} ${(box.y - pad).toFixed(2)} ${(box.width + 2 * pad).toFixed(2)} ${(box.height + 2 * pad).toFixed(2)}`);
    root.setAttribute("width", (box.width + 2 * pad).toFixed(2));
    root.setAttribute("height", (box.height + 2 * pad).toFixed(2));
    return { ok: true, svg: shortColors(new XMLSerializer().serializeToString(root)), w: box.width, h: box.height };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 120) };
  }
};
