import { sanitizeSvg } from "../assets/sanitize";
import type { OpenBioFigureProject, ProjectObject } from "../project/schema";
import { createTemplateProject, FIGURE_TEMPLATES, type FigureTemplateId } from "./templates";

/**
 * Creates a template project and places its library artwork. Drawings are loaded
 * through the verified catalog (integrity-checked) and sized with the same Fabric
 * geometry the editor uses. Any drawing that cannot load (offline, removed from the
 * library) is skipped, so a template always opens.
 */
export async function createTemplateProjectWithArtwork(templateId: FigureTemplateId): Promise<OpenBioFigureProject> {
  const project = createTemplateProject(templateId);
  const artwork = FIGURE_TEMPLATES.find((template) => template.id === templateId)?.artwork ?? [];
  if (!artwork.length) return project;
  try {
    const [{ seedCatalog, getSeedSvg }, { loadDrawingParts, drawingGroup }] = await Promise.all([
      import("../../assets/catalog"),
      import("../../editor/svgDrawing"),
    ]);
    const byId = new Map(seedCatalog.map((asset) => [asset.id, asset]));
    const sizes = new Map<string, { svg: string; width: number; height: number }>();
    const placed: ProjectObject[] = [];
    for (const item of artwork) {
      const meta = byId.get(item.assetId);
      if (!meta) continue;
      try {
        let loaded = sizes.get(meta.id);
        if (!loaded) {
          const svg = sanitizeSvg(await getSeedSvg(meta)).svg;
          const group = drawingGroup(await loadDrawingParts(svg));
          loaded = { svg, width: Math.max(1, group.width ?? 1), height: Math.max(1, group.height ?? 1) };
          sizes.set(meta.id, loaded);
          const { file, integrity, ...metadata } = meta;
          void file; void integrity;
          project.assets.push({ ...metadata, svg, verified: true });
        }
        const scale = item.size / Math.max(loaded.width, loaded.height);
        placed.push({
          id: globalThis.crypto.randomUUID(), name: item.name ?? meta.title, kind: "svg", assetId: meta.id,
          x: item.x, y: item.y, width: loaded.width, height: loaded.height, scaleX: scale, scaleY: scale,
          angle: 0, opacity: 1, visible: true, locked: false, fill: null, stroke: null, strokeWidth: 0,
        });
      } catch {
        /* skip this drawing; the template still opens */
      }
    }
    // Shapes first (panels, membranes), artwork above them, labels on top.
    const labels = project.objects.filter((object) => object.kind === "text");
    const shapes = project.objects.filter((object) => object.kind !== "text");
    project.objects = [...shapes, ...placed, ...labels];
  } catch {
    /* library unavailable: return the shape-only template */
  }
  return project;
}
