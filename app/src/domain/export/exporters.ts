import { generateAttributions } from "../licensing/attribution";
import { parseProject, type OpenBioFigureProject } from "../project/schema";
import { sanitizeSvg } from "../assets/sanitize";
import { assertByteLimit, INPUT_LIMITS } from "../security/input";
import { normalizeFabricSvgIdentifiers } from "./fabricSvgIdentifiers";
import { imageDataUrl } from "../media/images";
import { InputError } from "../security/input";

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function safeFileStem(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "") || "openbiofigure"
  );
}

export function buildProjectJson(project: OpenBioFigureProject): string {
  const output = JSON.stringify(parseProject(project), null, 2) + "\n";
  assertByteLimit(output, INPUT_LIMITS.projectBytes);
  return output;
}

export function buildSvgExport(
  canvasSvg: string,
  project: OpenBioFigureProject,
): string {
  project = parseProject(project);
  // Remove only Fabric's fixed XML declaration, which includes an unnecessary standalone field.
  canvasSvg = canvasSvg.replace(/^<\?xml version="1.0" encoding="UTF-8" standalone="no" \?>\s*/, "");
  // Fabric emits this fixed external DTD. Local imports never receive this exception.
  canvasSvg = canvasSvg.replace(/<!DOCTYPE svg PUBLIC "-\/\/W3C\/\/DTD SVG 1\.1\/\/EN" "http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd">\s*/, "");
  // Imported SVG never accepts raster references. The renderer's own image
  // elements are replaced by inert rectangles while the vector scene is
  // sanitized, then rebuilt only from matching validated project media.
  const images: { id: string; href: string }[] = [];
  if (project.media.length) {
    assertByteLimit(canvasSvg, INPUT_LIMITS.projectBytes);
    const doc = new DOMParser().parseFromString(canvasSvg, "image/svg+xml");
    if (doc.querySelector("parsererror")) throw new InputError("invalid_svg", "The exported SVG is invalid.");
    for (const element of Array.from(doc.querySelectorAll("image"))) {
      const href = element.getAttribute("xlink:href") ?? element.getAttribute("href") ?? "";
      if (!project.media.some(media => imageDataUrl(media) === href))
        throw new InputError("invalid_image", "The exported image is not present in this project.");
      const id = `openrender_raster_slot_${images.length}`;
      const placeholder = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.localName === "href" || attribute.name === "image-rendering") continue;
        placeholder.setAttribute(attribute.name, attribute.value);
      }
      placeholder.setAttribute("id", id);
      element.replaceWith(placeholder);
      images.push({id, href});
    }
    canvasSvg = new XMLSerializer().serializeToString(doc.documentElement);
  }
  canvasSvg = sanitizeSvg(normalizeFabricSvgIdentifiers(canvasSvg)).svg;
  const attribution = generateAttributions(project);
  const metadata = escapeXml(
    JSON.stringify({
      generator: "Di-Render 0.2.0 (Di-Render 0.1.0 / OpenBioFigure 0.3.0 adaptation)",
      projectFormat: project.formatVersion,
      title: project.metadata.title,
      attributions: attribution.check.assets.map((asset) => ({
        id: asset.id,
        creator: asset.creator.name,
        license: asset.license.id,
        licenseUrl: asset.license.url,
        source: asset.source.sourceUrl,
        attribution: asset.attribution.text,
        modified: asset.attribution.modified,
        modificationNotes: asset.attribution.modificationNotes,
      })),
    }),
  );
  const output = canvasSvg.replace(
    /(<svg\b[^>]*>)/,
    (_match, root: string) => root + '<metadata id="openbiofigure-metadata">' + metadata + "</metadata>",
  );
  const safe = sanitizeSvg(output).svg;
  if (!images.length) return safe;
  const doc = new DOMParser().parseFromString(safe, "image/svg+xml");
  for (const { id, href } of images) {
    const placeholder = doc.getElementById(id);
    if (!placeholder || placeholder.localName !== "rect") throw new InputError("invalid_svg", "An exported image slot is missing.");
    const image = doc.createElementNS("http://www.w3.org/2000/svg", "image");
    for (const attribute of Array.from(placeholder.attributes)) {
      if (attribute.name !== "id") image.setAttribute(attribute.name, attribute.value);
    }
    image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
    placeholder.replaceWith(image);
  }
  const result = new XMLSerializer().serializeToString(doc.documentElement);
  assertByteLimit(result, INPUT_LIMITS.projectBytes);
  return result;
}

export function makeDownload(
  content: BlobPart,
  type: string,
  filename: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
