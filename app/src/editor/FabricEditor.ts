import { identityTransform, plotTransform, type LinearTransform } from '../domain/plots/transform';
import { prepareProjectPlots } from '../domain/plots/prepare';
import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricObject,
  FabricImage,
  Group,
  IText,
  Line,
  Path,
  Rect,
  Triangle,
  util,
} from "fabric";
import { drawingGroup, loadDrawingParts } from "./svgDrawing";
import { createNativeShape, updateNativeShape } from "./nativeShape";
import { createPlotObject, updatePlotObject } from './plotObject';
import type { PlotSpec } from '../domain/plots/spec';
import type { DataSource, Dataset } from '../domain/data/schema';
import type { ProjectAsset } from "../domain/assets/schema";
import { sanitizeSvg, isSafePaint } from "../domain/assets/sanitize";
import { bakeArtworkPaint, createArtworkVariant } from "../domain/assets/artwork";
import {
  parseProject,
  type OpenBioFigureProject,
  type ProjectObject,
} from "../domain/project/schema";
import { assertPngDimensions, InputError } from "../domain/security/input";
import { findShape, SHAPE_STYLE, type ShapeId } from "../domain/shapes/registry";
import { imageDataUrl, type ProjectImage } from "../domain/media/images";
import {
  createScientificElement,
  type ScientificElementKind,
} from "../domain/scientific/elements";

type ObjectKind = ProjectObject["kind"];
type ConnectorObject = Extract<ProjectObject, { kind: "connector" }>;
type ConnectorAttachment = NonNullable<ConnectorObject["start"]>;
type ConnectorRouting = NonNullable<ConnectorObject["routing"]>;
type ManagedObject = FabricObject & {
  obfId?: string;
  obfKind?: ObjectKind;
  obfName?: string;
  obfAssetId?: string;
  obfShapeId?: ShapeId;
  obfAdjustment?: number;
  obfLabel?: string;
  obfPlot?: PlotSpec;
  obfPlotNotices?: string[];
  obfPlotError?: string | null;
  obfMediaId?: string;
  obfConnectorStart?: ConnectorAttachment | null;
  obfConnectorEnd?: ConnectorAttachment | null;
  obfConnectorRouting?: ConnectorRouting;
  obfConnectorPoints?: [number, number, number, number];
};

export interface SelectionSnapshot {
  count: number;
  id: string | null;
  kind: ObjectKind | "mixed" | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  fontFamily?: string;
  fontSize?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  shapeId?: ShapeId;
  adjustment?: number;
  label?: string;
  plot?: PlotSpec;
  plotNotices?: string[];
  plotError?: string | null;
  mediaId?: string;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  imageWidth?: number;
  imageHeight?: number;
  flipX?: boolean;
  flipY?: boolean;
  connectorStart?: ConnectorAttachment | null;
  connectorEnd?: ConnectorAttachment | null;
  connectorRouting?: ConnectorRouting;
  locked: boolean;
  visible: boolean;
}

export interface LayerSnapshot {
  id: string;
  name: string;
  kind: ObjectKind;
  locked: boolean;
  visible: boolean;
  selected: boolean;
  description?: string;
}

export interface EditorSnapshot {
  project: OpenBioFigureProject;
  selection: SelectionSnapshot | null;
  layers: LayerSnapshot[];
}

export interface ArtworkTarget {
  object: Extract<ProjectObject, { kind: "svg" }>;
  asset: ProjectAsset;
  svg: string;
  documentId: string;
}

const newId = (): string => globalThis.crypto.randomUUID();

const defaults = {
  fill: "#DFF4F5",
  stroke: "#066F79",
  strokeWidth: 2,
  opacity: 1,
  originX: "center" as const,
  originY: "center" as const,
};

function tag(
  object: FabricObject,
  kind: ObjectKind,
  name: string,
  id = newId(),
): ManagedObject {
  const managed = object as ManagedObject;
  managed.obfId = id;
  managed.obfKind = kind;
  managed.obfName = name;
  object.set({ originX: "center", originY: "center" });
  return managed;
}

function colorValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function connectorPath(points: [number, number, number, number], routing: ConnectorRouting): string {
  const [x1, y1, x2, y2] = points;
  const middle = (x1 + x2) / 2;
  if (routing === "elbow") return `M ${x1} ${y1} L ${middle} ${y1} L ${middle} ${y2} L ${x2} ${y2}`;
  if (routing === "curved") return `M ${x1} ${y1} C ${middle} ${y1} ${middle} ${y2} ${x2} ${y2}`;
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function attachmentPoint(object: FabricObject, site: ConnectorAttachment["site"]): { x: number; y: number } {
  const center = object.getCenterPoint();
  if (site === "center") return center;
  const corners = object.getCoords();
  const [a, b] = site === "top" ? [corners[0]!, corners[1]!]
    : site === "right" ? [corners[1]!, corners[2]!]
    : site === "bottom" ? [corners[2]!, corners[3]!] : [corners[3]!, corners[0]!];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function allManagedObjects(objects: FabricObject[]): ManagedObject[] {
  return objects.flatMap(object => {
    const managed = object as ManagedObject;
    return managed.obfKind === "group" && object instanceof Group
      ? [managed, ...allManagedObjects(object.getObjects())] : [managed];
  });
}

function makeAttachedConnector(value: ConnectorObject): ManagedObject {
  const points: [number, number, number, number] = [
    value.x + value.points[0], value.y + value.points[1],
    value.x + value.points[2], value.y + value.points[3],
  ];
  const path = new Path(connectorPath(points, value.routing ?? "straight"), {
    fill: null, stroke: value.stroke ?? "#263238", strokeWidth: value.strokeWidth,
    originX: "center", originY: "center", selectable: !value.locked, evented: !value.locked,
    lockMovementX: true, lockMovementY: true, hasControls: false,
  });
  const managed = tag(path, "connector", value.name, value.id);
  managed.obfConnectorStart = value.start ?? null;
  managed.obfConnectorEnd = value.end ?? null;
  managed.obfConnectorRouting = value.routing ?? "straight";
  managed.obfConnectorPoints = points;
  managed.set({ opacity: value.opacity, visible: value.visible });
  return managed;
}

function common(object: ManagedObject) {
  const world = object.group instanceof ActiveSelection ? util.qrDecompose(object.calcTransformMatrix()) : null;
  return {
    id: object.obfId ?? newId(),
    name: object.obfName ?? "Object",
    x: world?.translateX ?? object.left,
    y: world?.translateY ?? object.top,
    width: Math.max(0.1, object.width),
    height: Math.max(0.1, object.height),
    scaleX: Math.max(0.001, world?.scaleX ?? object.scaleX),
    scaleY: Math.max(0.001, world?.scaleY ?? object.scaleY),
    angle: world?.angle ?? object.angle,
    opacity: object.opacity,
    visible: object.visible,
    locked: !object.selectable,
    fill: colorValue(object.fill),
    stroke: colorValue(object.stroke),
    strokeWidth: object.strokeWidth,
  };
}

function serializeObject(object: ManagedObject): ProjectObject {
  const kind = object.obfKind ?? "rect";
  const base = common(object);
  if (kind === "text") {
    const text = object as IText & ManagedObject;
    return {
      ...base,
      kind,
      text: text.text,
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      fontWeight: typeof text.fontWeight === "number" || text.fontWeight === "normal" || text.fontWeight === "bold"
        ? text.fontWeight : Number(text.fontWeight),
      textAlign: text.textAlign as "left" | "center" | "right" | "justify",
    };
  }
  if (kind === "svg")
    return { ...base, kind, assetId: object.obfAssetId ?? "unknown" };
  if (kind === "shape")
    return { ...base, kind, shapeId: object.obfShapeId ?? "rectangle", adjustment: object.obfAdjustment ?? 0.4, label: object.obfLabel ?? "" };
  if (kind === 'plot') {
    if (!object.obfPlot) throw new InputError('plot_state', 'The plot specification is missing.');
    return { ...base, kind, plot: structuredClone(object.obfPlot) };
  }
  if (kind === "image") {
    const image = object as FabricImage & ManagedObject;
    return { ...base, kind, mediaId: image.obfMediaId ?? "unknown", cropX: image.cropX, cropY: image.cropY,
      cropWidth: Math.max(1, Math.round(image.width)), cropHeight: Math.max(1, Math.round(image.height)), flipX: image.flipX, flipY: image.flipY };
  }
  if (kind === "connector" && object instanceof Path && (object as ManagedObject).obfConnectorPoints) {
    const connector = object as ManagedObject & Path;
    const [x1, y1, x2, y2] = connector.obfConnectorPoints!;
    return { ...base, kind, points: [x1 - base.x, y1 - base.y, x2 - base.x, y2 - base.y],
      start: connector.obfConnectorStart ?? null, end: connector.obfConnectorEnd ?? null,
      routing: connector.obfConnectorRouting ?? "straight", scaleX: 1, scaleY: 1, angle: 0 };
  }
  if (kind === "line" || kind === "arrow" || kind === "connector") {
    const line = object as Line;
    return {
      ...base,
      kind,
      points: kind === "arrow" ? [0, base.height / 2, base.width, base.height / 2] : [line.x1, line.y1, line.x2, line.y2],
    };
  }
  if (kind === "group") {
    const group = object as Group & ManagedObject;
    return {
      ...base,
      kind,
      children: group
        .getObjects()
        .map((child) => serializeObject(child as ManagedObject)),
    };
  }
  return { ...base, kind };
}

function applyCommon(
  object: FabricObject,
  value: ProjectObject,
): ManagedObject {
  object.set({
    left: value.x,
    top: value.y,
    width: object instanceof Line ? object.width : value.width,
    height: object instanceof Line ? object.height : value.height,
    scaleX: value.scaleX,
    scaleY: value.scaleY,
    angle: value.angle,
    opacity: value.opacity,
    visible: value.visible,
    fill: value.fill ?? undefined,
    stroke: value.stroke ?? undefined,
    strokeWidth: value.strokeWidth,
    selectable: !value.locked,
    evented: !value.locked,
    lockMovementX: value.locked,
    lockMovementY: value.locked,
    originX: "center",
    originY: "center",
  });
  return tag(object, value.kind, value.name, value.id);
}

function makeArrow(width = 180, color = "#263238"): Group {
  const line = new Line([-width / 2, 0, width / 2 - 12, 0], {
    stroke: color,
    strokeWidth: 3,
    originX: "center",
    originY: "center",
  });
  const head = new Triangle({
    width: 14,
    height: 16,
    fill: color,
    left: width / 2 - 5,
    top: 0,
    angle: 90,
    originX: "center",
    originY: "center",
  });
  return new Group([line, head], { originX: "center", originY: "center" });
}

function makeShape(value: Extract<ProjectObject, { kind: "shape" }>): ManagedObject {
  const shape = createNativeShape(value) as ManagedObject;
  shape.obfShapeId = value.shapeId;
  shape.obfAdjustment = value.adjustment;
  shape.obfLabel = value.label;
  return shape;
}

function applySvgPaint(object: FabricObject, values: {fill?: string | null; stroke?: string | null}) {
  if (object instanceof Group) object.getObjects().forEach(child => applySvgPaint(child, values));
  else {
    if (values.fill !== undefined && object.fill && object.fill !== "none") object.set("fill", values.fill);
    if (values.stroke !== undefined && object.stroke && object.stroke !== "none") object.set("stroke", values.stroke);
  }
}

async function objectFromProject(
  value: ProjectObject,
  assets: ProjectAsset[],
  media: ProjectImage[],
  sources: DataSource[] = [],
  datasets: Dataset[] = [],
  parentTransform: LinearTransform = identityTransform,
): Promise<ManagedObject> {
  const world = plotTransform(parentTransform, value);
  let object: FabricObject;
  if (value.kind === "rect")
    object = new Rect({
      ...defaults,
      width: value.width,
      height: value.height,
    });
  else if (value.kind === "ellipse") {
    object = new Ellipse({
      ...defaults,
      rx: value.width / 2,
      ry: value.height / 2,
    });
  } else if (value.kind === "text") {
    object = new IText(value.text, {
      fill: value.fill ?? "#263238",
      fontFamily: value.fontFamily,
      fontSize: value.fontSize,
      fontWeight: value.fontWeight,
      textAlign: value.textAlign,
      originX: "center",
      originY: "center",
    });
  } else if (value.kind === "connector" && (value.start || value.end || value.routing && value.routing !== "straight")) {
    return makeAttachedConnector(value);
  } else if (value.kind === "line" || value.kind === "connector") {
    object = new Line(value.points, {
      stroke: value.stroke ?? "#263238",
      strokeWidth: value.strokeWidth,
      originX: "center",
      originY: "center",
    });
  } else if (value.kind === "arrow")
    object = makeArrow(Math.max(0.1, value.width - 5), value.stroke ?? "#263238");
  else if (value.kind === "shape") object = makeShape(value);
  else if (value.kind === 'plot') {
    const created = createPlotObject(value, sources, datasets, world.scaleX, world.scaleY, world.skewX);
    object = created.group;
    if (!created.scene.error) value.plot.result = created.scene.result;
    (object as ManagedObject).obfPlot = structuredClone(value.plot);
    (object as ManagedObject).obfPlotNotices = created.scene.notices;
    (object as ManagedObject).obfPlotError = created.scene.error;
  }
  else if (value.kind === "image") {
    const source = media.find(candidate => candidate.id === value.mediaId);
    if (!source) throw new InputError("missing_image", "This project image is missing.");
    const element = new Image();
    element.src = imageDataUrl(source);
    try { await element.decode(); }
    catch { throw new InputError("invalid_image", "The project image could not be decoded."); }
    if (element.naturalWidth !== source.width || element.naturalHeight !== source.height)
      throw new InputError("invalid_image", "The project image dimensions changed.");
    object = new FabricImage(element, { cropX: value.cropX, cropY: value.cropY,
      width: value.cropWidth, height: value.cropHeight, flipX: value.flipX, flipY: value.flipY });
    (object as ManagedObject).obfMediaId = value.mediaId;
  }
  else if (value.kind === "svg") {
    const asset = assets.find((candidate) => candidate.id === value.assetId);
    if (!asset) throw new Error(`Missing project asset ${value.assetId}.`);
    object = drawingGroup(await loadDrawingParts(sanitizeSvg(asset.svg).svg));
    (object as ManagedObject).obfAssetId = value.assetId;
    if (value.fill !== null) applySvgPaint(object, {fill: value.fill});
    if (value.stroke !== null) applySvgPaint(object, {stroke: value.stroke});
  } else if (value.kind === "group") {
    const children = await Promise.all(
      value.children.map((child: ProjectObject) =>
        objectFromProject(child, assets, media, sources, datasets, world.matrix),
      ),
    );
    object = new Group(children, { originX: "center", originY: "center" });
    // Stored children already use the group's local coordinates. Fabric's
    // initial fit layout recenters them; restore those coordinates explicitly.
    children.forEach((child, index) => {
      child.set({left: value.children[index]!.x, top: value.children[index]!.y});
      child.setCoords();
    });
  } else {
    throw new Error(
      `Unsupported object kind: ${String((value as { kind?: unknown }).kind)}`,
    );
  }
  return applyCommon(object, value);
}

export class FabricEditor {
  readonly canvas: Canvas;
  readonly ready: Promise<void>;
  #project: OpenBioFigureProject;
  #onChange: (snapshot: EditorSnapshot) => void;
  #onError: (error: unknown) => void;
  #onBusy: (busy: boolean) => void;
  #suspend = false;
  #documentGeneration = 0;
  #preparation: AbortController | null = null;
  #clipboard: ProjectObject[] = [];

  constructor(
    element: HTMLCanvasElement,
    project: OpenBioFigureProject,
    onChange: (snapshot: EditorSnapshot) => void,
    onError: (error: unknown) => void = error => { throw error; },
    onBusy: (busy: boolean) => void = () => undefined,
  ) {
    project = parseProject(project);
    this.#project = structuredClone(project);
    this.#onChange = onChange;
    this.#onError = onError;
    this.#onBusy = onBusy;
    this.canvas = new Canvas(element, {
      width: project.document.width,
      height: project.document.height,
      backgroundColor: project.document.background,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selectionColor: "rgba(43, 135, 204, 0.10)",
      selectionBorderColor: "#2B87CC",
      selectionLineWidth: 1,
    });
    Object.assign(FabricObject.ownDefaults, {
      borderColor: "#2B87CC",
      cornerColor: "#FFFFFF",
      cornerStrokeColor: "#2B87CC",
      cornerStyle: "rect",
      cornerSize: 9,
      transparentCorners: false,
      padding: 2,
    });
    this.canvas.on("object:modified", () => { this.finishModification(); });
    this.canvas.on("object:moving", ({ target }) => {
      if (!target) return;
      if (!this.#project.settings.grid.snap) { this.refreshConnectors(); return; }
      const size = this.#project.settings.grid.size;
      target.set({
        left: Math.round(target.left / size) * size,
        top: Math.round(target.top / size) * size,
      });
      this.refreshConnectors();
    });
    this.canvas.on("object:scaling", () => this.refreshConnectors());
    this.canvas.on("object:rotating", () => this.refreshConnectors());
    this.canvas.on("selection:created", () => this.emit());
    this.canvas.on("selection:updated", () => this.emit());
    this.canvas.on("selection:cleared", () => this.emit());
    this.canvas.on("text:changed", () => this.commit());
    this.ready = this.load(project);
  }

  dispose() {
    this.#documentGeneration++;
    this.#preparation?.abort();
    void this.canvas.dispose();
  }

  async load(project: OpenBioFigureProject) {
    const generation = ++this.#documentGeneration;
    this.#preparation?.abort();
    const preparation = this.#preparation = new AbortController();
    this.#onBusy(true);
    try {
      await prepareProjectPlots(project, preparation.signal);
      await document.fonts?.ready;
      const accepted = parseProject(project), objects: ManagedObject[] = [];
      // Stage every object before changing the last valid canvas/document.
      for (const value of accepted.objects)
        objects.push(await objectFromProject(value, accepted.assets, accepted.media, accepted.dataSources, accepted.datasets));
      if (generation !== this.#documentGeneration) throw new InputError('plot_cancelled', 'The figure changed while preparing the plot.');
      this.#suspend = true;
      try {
        this.canvas.clear();
        this.canvas.setDimensions({ width: accepted.document.width, height: accepted.document.height });
        this.canvas.backgroundColor = accepted.document.background;
        this.canvas.add(...objects);
        this.#project = accepted;
        this.refreshConnectors();
        this.canvas.requestRenderAll();
      } finally { this.#suspend = false; }
      this.emit();
    } finally { if (generation === this.#documentGeneration) this.#onBusy(false); }
  }

  getProject(): OpenBioFigureProject {
    return structuredClone(this.#project);
  }

  async updateData(datasets: Dataset[], sources: DataSource[], objects = this.getProject().objects) {
    const used = new Set(datasets.map(dataset => dataset.sourceId));
    const next = { ...this.getProject(), objects, datasets, dataSources: sources.filter(source => used.has(source.id)) };
    next.metadata.updatedAt = new Date().toISOString();
    await this.load(next);
  }

  async applyPlot(plot: PlotSpec, targetId?: string, draftData?: { source: DataSource; dataset: Dataset }) {
    const next = this.getProject();
    // Commit draft data and the plot in the same validated load/undo boundary.
    if (draftData) {
      if (draftData.dataset.id !== plot.datasetId || next.datasets.some(dataset => dataset.id === draftData.dataset.id)) throw new InputError('plot_stale', 'The plot data changed. Reopen Insert plot.');
      next.datasets.push(draftData.dataset);
      if (!next.dataSources.some(source => source.id === draftData.source.id)) next.dataSources.push(draftData.source);
    }
    let updated = false;
    const visit = (objects: ProjectObject[]) => objects.forEach(object => {
      if (object.kind === 'plot' && object.id === targetId) { object.plot = plot; object.name = plot.appearance.title || plot.type; updated = true; }
      if (object.kind === 'group') visit(object.children);
    });
    visit(next.objects);
    if (targetId && !updated) throw new InputError('plot_stale', 'The plot changed or was removed. Reopen Edit plot.');
    const id = targetId ?? newId();
    if (!targetId) next.objects.push({ id, kind: 'plot', name: plot.appearance.title || plot.type, ...this.center(), width: 520, height: 380, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, visible: true, locked: false, fill: '#FFFFFF', stroke: null, strokeWidth: 0, plot });
    next.metadata.updatedAt = new Date().toISOString();
    await this.load(next); this.select(id);
  }

  private syncProject(touch = false) {
    this.#project.objects = this.canvas
      .getObjects()
      .map((object) => serializeObject(object as ManagedObject));
    const usedImages = new Set<string>();
    const collectImages = (objects: ProjectObject[]) => objects.forEach(object => {
      if (object.kind === "image") usedImages.add(object.mediaId);
      if (object.kind === "group") collectImages(object.children);
    });
    collectImages(this.#project.objects);
    this.#project.media = this.#project.media.filter(image => usedImages.has(image.id));
    const usedSources = new Set(this.#project.datasets.map(dataset => dataset.sourceId));
    this.#project.dataSources = this.#project.dataSources.filter(source => usedSources.has(source.id));
    this.#project.document.background =
      typeof this.canvas.backgroundColor === "string"
        ? this.canvas.backgroundColor
        : "#ffffff";
    if (touch) this.#project.metadata.updatedAt = new Date().toISOString();
  }

  private refreshConnectors() {
    const objects = allManagedObjects(this.canvas.getObjects());
    const byId = new Map(objects.map(object => [object.obfId, object]));
    for (const connector of objects) {
      if (connector.obfKind !== "connector" || !(connector instanceof Path) || !(connector as ManagedObject).obfConnectorPoints) continue;
      const pathConnector = connector as ManagedObject & Path;
      const points = [...pathConnector.obfConnectorPoints!] as [number, number, number, number];
      for (const [attachment, offset] of [[pathConnector.obfConnectorStart, 0], [pathConnector.obfConnectorEnd, 2]] as const) {
        if (!attachment) continue;
        const target = byId.get(attachment.objectId);
        if (!target || target === connector) {
          if (offset === 0) pathConnector.obfConnectorStart = null;
          else pathConnector.obfConnectorEnd = null;
          continue;
        }
        const point = attachmentPoint(target, attachment.site);
        points[offset] = point.x;
        points[offset + 1] = point.y;
      }
      const geometry = new Path(connectorPath(points, pathConnector.obfConnectorRouting ?? "straight"));
      pathConnector.set({ path: geometry.path, pathOffset: geometry.pathOffset,
        width: Math.max(0.1, geometry.width), height: Math.max(0.1, geometry.height),
        left: geometry.left, top: geometry.top });
      pathConnector.obfConnectorPoints = points;
      pathConnector.dirty = true;
      pathConnector.setCoords();
    }
    this.canvas.requestRenderAll();
  }

  private commit() {
    if (this.#suspend) return;
    this.syncProject(true);
    this.emit();
  }

  private emit() {
    if (this.#suspend) return;
    this.#onChange({
      project: this.getProject(),
      selection: this.getSelection(),
      layers: this.getLayers(),
    });
  }

  private center() {
    return {
      x: this.#project.document.width / 2,
      y: this.#project.document.height / 2,
    };
  }

  addRect() {
    const { x, y } = this.center();
    const object = tag(
      new Rect({ ...defaults, width: 180, height: 110, left: x, top: y }),
      "rect",
      "Rectangle",
    );
    this.addAndSelect(object);
  }

  addEllipse() {
    const { x, y } = this.center();
    const object = tag(
      new Ellipse({ ...defaults, rx: 75, ry: 55, left: x, top: y }),
      "ellipse",
      "Ellipse",
    );
    this.addAndSelect(object);
  }

  addText() {
    const { x, y } = this.center();
    const object = tag(
      new IText("Scientific label", {
        left: x,
        top: y,
        fill: "#263238",
        fontFamily: "IBM Plex Sans",
        fontSize: 30,
        originX: "center",
        originY: "center",
      }),
      "text",
      "Text",
    );
    this.addAndSelect(object);
  }

  addLine(kind: "line" | "connector" = "line") {
    const { x, y } = this.center();
    const object = tag(
      new Line([-90, 0, 90, 0], {
        left: x,
        top: y,
        stroke: "#263238",
        strokeWidth: 3,
        originX: "center",
        originY: "center",
      }),
      kind,
      kind === "line" ? "Line" : "Connector",
    );
    this.addAndSelect(object);
  }

  addArrow() {
    const { x, y } = this.center();
    const object = tag(makeArrow(), "arrow", "Arrow");
    object.set({ left: x, top: y });
    this.addAndSelect(object);
  }

  async addShape(shapeId: ShapeId) {
    const definition = findShape(shapeId);
    if (!definition) throw new InputError("unknown_shape", "This shape is unavailable.");
    const { x, y } = this.center();
    await this.addProjectObject({
      id: newId(), name: definition.name, kind: "shape", shapeId,
      adjustment: 0.4, label: "", x, y, width: definition.width, height: definition.height,
      scaleX: 1, scaleY: 1,
      angle: 0, opacity: 1, visible: true, locked: false,
      ...SHAPE_STYLE,
    });
  }

  async addScientificElement(kind: ScientificElementKind) {
    const generation = this.#documentGeneration;
    const { x, y } = this.center();
    const object = await objectFromProject(
      createScientificElement(kind, x, y),
      this.#project.assets,
      this.#project.media,
    );
    if (generation !== this.#documentGeneration) return;
    this.addAndSelect(object);
  }

  async addProjectObject(value: ProjectObject) {
    const generation = this.#documentGeneration;
    value = parseProject({ ...this.#project, objects: [...this.#project.objects, value] }).objects.at(-1)!;
    const object = await objectFromProject(value, this.#project.assets, this.#project.media, this.#project.dataSources, this.#project.datasets);
    if (generation !== this.#documentGeneration) return;
    this.addAndSelect(object);
  }

  async addAsset(asset: ProjectAsset, point?: { x: number; y: number }) {
    const generation = this.#documentGeneration;
    const probe: ProjectObject = {
      id: newId(), name: asset.title, kind: "svg", assetId: asset.id,
      x: point?.x ?? 0, y: point?.y ?? 0, width: 1, height: 1,
      scaleX: 1, scaleY: 1, angle: 0, opacity: 1,
      visible: true, locked: false, fill: null, stroke: null, strokeWidth: 0,
    };
    const validateInsertion = () => {
      const accepted = parseProject({ ...this.#project, assets: [
        ...this.#project.assets.filter(candidate => candidate.id !== asset.id), asset,
      ], objects: [...this.#project.objects, probe] }).assets.find(candidate => candidate.id === asset.id)!;
      const existing = this.#project.assets.find(candidate => candidate.id === asset.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(accepted))
        throw new InputError("asset_collision", "An asset with this ID already has different artwork or provenance. Import it with a new ID.");
      return accepted;
    };
    asset = validateInsertion();
    const parts = await loadDrawingParts(sanitizeSvg(asset.svg).svg);
    if (generation !== this.#documentGeneration) return false;
    asset = validateInsertion(); // Concurrent edits must still fit the document budget.
    if (!parts.length) throw new InputError("empty_asset", "This SVG has no supported visible geometry.");
    const object = drawingGroup(parts);
    const max = 220;
    const scale = Math.min(max / Math.max(object.width, object.height), 1);
    const target = point ?? this.center();
    const managed = tag(object, "svg", asset.title);
    managed.obfAssetId = asset.id;
    managed.set({
      left: target.x,
      top: target.y,
      fill: null,
      stroke: null,
      scaleX: scale,
      scaleY: scale,
    });
    if (!this.#project.assets.some((candidate) => candidate.id === asset.id))
      this.#project.assets.push(asset);
    this.addAndSelect(managed);
    return true;
  }

  async addImage(media: ProjectImage, point?: { x: number; y: number }) {
    const generation = this.#documentGeneration;
    const existing = this.#project.media.find(candidate => candidate.id === media.id);
    if (existing && existing.data !== media.data)
      throw new InputError("image_collision", "An image with this ID has different bytes.");
    const { x, y } = point ?? this.center();
    const scale = Math.min(220 / Math.max(media.width, media.height), 1);
    const value: Extract<ProjectObject, { kind: "image" }> = {
      id: newId(), name: media.name, kind: "image", mediaId: media.id,
      x, y, width: media.width, height: media.height,
      cropX: 0, cropY: 0, cropWidth: media.width, cropHeight: media.height,
      flipX: false, flipY: false, scaleX: scale, scaleY: scale,
      angle: 0, opacity: 1, visible: true, locked: false,
      fill: null, stroke: null, strokeWidth: 0,
    };
    parseProject({ ...this.#project, media: existing ? this.#project.media : [...this.#project.media, media],
      objects: [...this.#project.objects, value] });
    const object = await objectFromProject(value, this.#project.assets, [...this.#project.media, media]);
    if (generation !== this.#documentGeneration) return false;
    if (!existing) this.#project.media.push(media);
    this.addAndSelect(object);
    return true;
  }

  async replaceSelectedImage(media: ProjectImage) {
    const current = this.canvas.getActiveObject() as ManagedObject | undefined;
    if (!(current instanceof FabricImage) || (current as ManagedObject).obfKind !== "image" || !current.selectable) return false;
    const generation = this.#documentGeneration;
    const existing = this.#project.media.find(candidate => candidate.id === media.id);
    if (existing && existing.data !== media.data) throw new InputError("image_collision", "An image with this ID has different bytes.");
    const prior = serializeObject(current);
    if (prior.kind !== "image") return false;
    const frameRatio = current.getScaledWidth() / current.getScaledHeight();
    const sourceRatio = media.width / media.height;
    const cropWidth = sourceRatio > frameRatio ? Math.max(1, Math.round(media.height * frameRatio)) : media.width;
    const cropHeight = sourceRatio > frameRatio ? media.height : Math.max(1, Math.round(media.width / frameRatio));
    const next: Extract<ProjectObject, {kind: "image"}> = {
      ...prior, mediaId: media.id, width: cropWidth, height: cropHeight,
      cropX: Math.floor((media.width - cropWidth) / 2), cropY: Math.floor((media.height - cropHeight) / 2),
      cropWidth, cropHeight,
      scaleX: current.getScaledWidth() / cropWidth, scaleY: current.getScaledHeight() / cropHeight,
    };
    parseProject({ ...this.#project, media: existing ? this.#project.media : [...this.#project.media, media],
      objects: this.#project.objects.map(value => value.id === prior.id ? next : value) });
    const replacement = await objectFromProject(next, this.#project.assets, [...this.#project.media, media]);
    if (generation !== this.#documentGeneration || this.canvas.getActiveObject() !== current) return false;
    const index = this.canvas.getObjects().indexOf(current);
    if (index < 0) return false;
    this.#suspend = true;
    try {
      if (!existing) this.#project.media.push(media);
      this.canvas.discardActiveObject();
      this.canvas.remove(current);
      this.canvas.insertAt(index, replacement);
      this.canvas.setActiveObject(replacement);
      this.canvas.requestRenderAll();
    } finally { this.#suspend = false; }
    this.commit();
    return true;
  }

  private addAndSelect(object: FabricObject) {
    const wasSuspended = this.#suspend;
    this.#suspend = true;
    try {
      this.canvas.add(object);
      this.canvas.setActiveObject(object);
      this.canvas.requestRenderAll();
    } finally { this.#suspend = wasSuspended; }
    this.commit();
  }

  getSelection(): SelectionSnapshot | null {
    const active = this.canvas.getActiveObject();
    if (!active) return null;
    const selected =
      active instanceof ActiveSelection ? active.getObjects() : [active];
    const kinds = new Set(
      selected.map((item) => (item as ManagedObject).obfKind),
    );
    const base: ManagedObject =
      selected.length === 1 ? (selected[0] as ManagedObject) : active;
    const text = base as IText & ManagedObject;
    return {
      count: selected.length,
      id: selected.length === 1 ? (base.obfId ?? null) : null,
      kind: kinds.size === 1 ? ([...kinds][0] ?? null) : "mixed",
      name:
        selected.length === 1
          ? (base.obfName ?? "Object")
          : `${selected.length} objects`,
      x: Math.round(active.left),
      y: Math.round(active.top),
      width: Math.round(active.getScaledWidth()),
      height: Math.round(active.getScaledHeight()),
      angle: Math.round(active.angle),
      opacity: active.opacity,
      fill: colorValue(base.fill),
      stroke: colorValue(base.stroke),
      strokeWidth: base.strokeWidth,
      fontFamily: text.fontFamily,
      fontSize: text.fontSize,
      textAlign: text.textAlign as SelectionSnapshot["textAlign"],
      shapeId: base.obfShapeId,
      adjustment: base.obfAdjustment,
      label: base.obfLabel,
      plot: base.obfPlot ? structuredClone(base.obfPlot) : undefined,
      plotNotices: base.obfPlotNotices,
      plotError: base.obfPlotError,
      mediaId: base.obfMediaId,
      cropX: base instanceof FabricImage ? base.cropX : undefined,
      cropY: base instanceof FabricImage ? base.cropY : undefined,
      cropWidth: base instanceof FabricImage ? base.width : undefined,
      cropHeight: base instanceof FabricImage ? base.height : undefined,
      imageWidth: base.obfMediaId ? this.#project.media.find(image => image.id === base.obfMediaId)?.width : undefined,
      imageHeight: base.obfMediaId ? this.#project.media.find(image => image.id === base.obfMediaId)?.height : undefined,
      flipX: base instanceof FabricImage ? base.flipX : undefined,
      flipY: base instanceof FabricImage ? base.flipY : undefined,
      connectorStart: base.obfKind === "connector" ? base.obfConnectorStart ?? null : undefined,
      connectorEnd: base.obfKind === "connector" ? base.obfConnectorEnd ?? null : undefined,
      connectorRouting: base.obfKind === "connector" ? base.obfConnectorRouting ?? "straight" : undefined,
      locked: selected.every((item) => !item.selectable),
      visible: selected.every((item) => item.visible),
    };
  }

  getArtworkTarget(): ArtworkTarget | null {
    const active = this.canvas.getActiveObject() as ManagedObject | undefined;
    if (!active || active.obfKind !== "svg" || !active.selectable) return null;
    const object = serializeObject(active);
    if (object.kind !== "svg") return null;
    const asset = this.#project.assets.find(item => item.id === object.assetId);
    if (!asset) return null;
    return {object, asset: structuredClone(asset), documentId: this.#project.metadata.id,
      svg: bakeArtworkPaint(asset.svg, object.fill, object.stroke)};
  }

  async applyArtworkEdit(target: ArtworkTarget, svg: string): Promise<void> {
    const generation = this.#documentGeneration;
    const original = this.canvas.getObjects().find(item => (item as ManagedObject).obfId === target.object.id) as ManagedObject | undefined;
    const assertCurrent = () => {
      if (generation !== this.#documentGeneration || target.documentId !== this.#project.metadata.id || !original ||
          !this.canvas.getObjects().includes(original) || JSON.stringify(serializeObject(original)) !== JSON.stringify(target.object))
        throw new InputError("artwork_stale", "The figure changed while this artwork was open. Reopen Edit artwork and try again.");
    };
    assertCurrent();
    const variant = createArtworkVariant(target.asset, svg);
    const parts = await loadDrawingParts(variant.svg);
    assertCurrent();
    if (!parts.length) throw new InputError("empty_asset", "Keep at least one drawable part in the artwork.");
    const replacement = drawingGroup(parts);
    if (replacement.width <= 0 || replacement.height <= 0) throw new InputError("empty_asset", "The artwork must have a nonzero width and height.");
    // Fit the edited artwork to the existing placed size. Store the new native
    // bounds so reloading cannot stretch the group's box independently of its parts.
    const next: Extract<ProjectObject, {kind: "svg"}> = {...target.object, assetId: variant.id,
      width: replacement.width, height: replacement.height,
      scaleX: target.object.width * target.object.scaleX / replacement.width,
      scaleY: target.object.height * target.object.scaleY / replacement.height,
      fill: null, stroke: null};
    const accepted = parseProject({...this.#project, assets: [...this.#project.assets, variant],
      objects: this.#project.objects.map(item => item.id === next.id ? next : item)});
    const managed = applyCommon(replacement, next);
    managed.obfAssetId = variant.id;
    const index = this.canvas.getObjects().indexOf(original!);
    this.#suspend = true;
    try {
      this.canvas.discardActiveObject();
      this.canvas.remove(original!);
      this.canvas.insertAt(index, managed);
      this.canvas.setActiveObject(managed);
      this.#project = accepted;
    } finally { this.#suspend = false; }
    managed.setCoords();
    this.canvas.requestRenderAll();
    this.commit();
  }

  getLayers(): LayerSnapshot[] {
    const selected = new Set(this.canvas.getActiveObjects());
    return [...this.canvas.getObjects()].reverse().map((object) => {
      const managed = object as ManagedObject;
      return {
        id: managed.obfId ?? "",
        name: managed.obfName ?? "Object",
        kind: managed.obfKind ?? "rect",
        description: managed.obfKind === 'plot' ? managed.obfPlotError ?? `${managed.obfPlot?.type}; ${managed.obfPlot?.result?.groups.map(group => `${group.label}: n=${group.descriptive.n}`).join('; ') ?? ''}${managed.obfPlot?.result ? `; ${managed.obfPlot.result.comparisons.map(comparison => `${comparison.result.test}: p=${comparison.selectedP ?? '—'}`).join('; ')}` : ''}` : undefined,
        locked: !managed.selectable,
        visible: managed.visible,
        selected: selected.has(object),
      };
    });
  }

  select(id: string) {
    const object = this.canvas
      .getObjects()
      .find((item) => (item as ManagedObject).obfId === id);
    if (object && object.visible) {
      this.canvas.setActiveObject(object);
      this.canvas.requestRenderAll();
      this.emit();
    }
  }

  updateSelection(values: Partial<SelectionSnapshot>) {
    const previous = this.getProject();
    const numeric = ["x", "y", "width", "height", "angle", "opacity", "strokeWidth", "fontSize", "cropX", "cropY", "cropWidth", "cropHeight"] as const;
    if (numeric.some(key => values[key] !== undefined && !Number.isFinite(values[key]))) return;
    if (values.opacity !== undefined && (values.opacity < 0 || values.opacity > 1)) return;
    if (values.name !== undefined && (!values.name.trim() || values.name.length > 10_000)) return;
    if (values.fill != null && !isSafePaint(values.fill)) return;
    if (values.stroke != null && !isSafePaint(values.stroke)) return;
    if (numeric.some(key => values[key] !== undefined && Math.abs(values[key]!) > 1_000_000)) return;
    if (values.fontSize !== undefined && (values.fontSize <= 0 || values.fontSize > 10_000)) return;
    if (values.strokeWidth !== undefined && (values.strokeWidth < 0 || values.strokeWidth > 10_000)) return;
    if (values.adjustment !== undefined && (!Number.isFinite(values.adjustment) || values.adjustment < 0.15 || values.adjustment > 0.85)) return;
    if (values.label !== undefined && values.label.length > 10_000) return;
    if (values.connectorStart !== undefined || values.connectorEnd !== undefined || values.connectorRouting !== undefined) {
      const active = this.canvas.getActiveObject() as ManagedObject | undefined;
      if (!active || active.obfKind !== "connector") return;
      const prior = serializeObject(active);
      if (prior.kind !== "connector") return;
      const next: ConnectorObject = { ...prior,
        start: values.connectorStart !== undefined ? values.connectorStart : prior.start ?? null,
        end: values.connectorEnd !== undefined ? values.connectorEnd : prior.end ?? null,
        routing: values.connectorRouting ?? prior.routing ?? "straight" };
      parseProject({ ...this.#project, objects: this.#project.objects.map(object => object.id === next.id ? next : object) });
      const replacement = next.start || next.end || next.routing !== "straight"
        ? makeAttachedConnector(next)
        : applyCommon(new Line(next.points, {stroke: next.stroke ?? "#263238", strokeWidth: next.strokeWidth,
          originX: "center", originY: "center"}), next);
      const index = this.canvas.getObjects().indexOf(active);
      if (index < 0) return;
      this.canvas.discardActiveObject();
      this.canvas.remove(active);
      this.canvas.insertAt(index, replacement);
      this.canvas.setActiveObject(replacement);
      this.refreshConnectors();
      this.commit();
      return;
    }
    const objects = this.canvas.getActiveObjects();
    if (!objects.length) return;
    if (["cropX", "cropY", "cropWidth", "cropHeight"].some(key => values[key as keyof SelectionSnapshot] !== undefined)) {
      if (objects.length !== 1 || !(objects[0] instanceof FabricImage)) return;
      const image = objects[0];
      const source = this.#project.media.find(candidate => candidate.id === (image as ManagedObject).obfMediaId);
      if (!source) return;
      const cropX = values.cropX ?? image.cropX;
      const cropY = values.cropY ?? image.cropY;
      const cropWidth = values.cropWidth ?? Math.min(image.width, source.width - cropX);
      const cropHeight = values.cropHeight ?? Math.min(image.height, source.height - cropY);
      if (![cropX, cropY, cropWidth, cropHeight].every(Number.isInteger) ||
        cropX < 0 || cropY < 0 || cropWidth < 1 || cropHeight < 1 ||
        cropX + cropWidth > source.width || cropY + cropHeight > source.height) return;
      const displayedWidth = image.getScaledWidth();
      const displayedHeight = image.getScaledHeight();
      image.set({ cropX, cropY, width: cropWidth, height: cropHeight,
        scaleX: displayedWidth / cropWidth, scaleY: displayedHeight / cropHeight });
      image.setCoords();
    }
    for (const object of objects) {
      const next: Record<string, unknown> = {};
      if (values.fill !== undefined) next.fill = values.fill;
      if (values.stroke !== undefined) next.stroke = values.stroke;
      if (values.strokeWidth !== undefined)
        next.strokeWidth = values.strokeWidth;
      if (values.opacity !== undefined) next.opacity = values.opacity;
      if (object instanceof FabricImage) {
        if (values.flipX !== undefined) next.flipX = values.flipX;
        if (values.flipY !== undefined) next.flipY = values.flipY;
      }
      if (values.fontFamily !== undefined && object instanceof IText)
        next.fontFamily = values.fontFamily;
      if (values.fontSize !== undefined && object instanceof IText)
        next.fontSize = values.fontSize;
      if (values.textAlign !== undefined && object instanceof IText)
        next.textAlign = values.textAlign;
      object.set(next);
      if (values.name !== undefined)
        (object as ManagedObject).obfName = values.name;
      const managed = object as ManagedObject;
      if (managed.obfKind === "shape" && object instanceof Group && managed.obfShapeId) {
        if (values.label !== undefined) managed.obfLabel = values.label;
        if (values.adjustment !== undefined) managed.obfAdjustment = values.adjustment;
      }
      if (
        managed.obfKind === "arrow" &&
        values.stroke !== undefined &&
        object instanceof Group
      ) {
        const [line, head] = object.getObjects();
        line?.set("stroke", values.stroke);
        head?.set("fill", values.stroke);
      }
      if (
        managed.obfKind === "svg" &&
        managed.obfAssetId &&
        (values.fill !== undefined || values.stroke !== undefined)
      ) {
        applySvgPaint(object, values);
        const asset = this.#project.assets.find(
          (candidate) => candidate.id === managed.obfAssetId,
        );
        if (asset) {
          asset.attribution.modified = true;
          asset.attribution.modificationNotes =
            "Visual style adjusted in Di-Render.";
        }
      }
    }
    const active = this.canvas.getActiveObject();
    if (active) {
      if (values.x !== undefined) active.set("left", values.x);
      if (values.y !== undefined) active.set("top", values.y);
      if (values.angle !== undefined) active.set("angle", values.angle);
      if (
        values.width !== undefined &&
        values.width > 0 &&
        objects.length === 1
      )
        active.scaleX *= values.width / active.getScaledWidth();
      if (
        values.height !== undefined &&
        values.height > 0 &&
        objects.length === 1
      )
        active.scaleY *= values.height / active.getScaledHeight();
      active.setCoords();
    }
    this.finishModification(previous);
  }

  private finishModification(previous = this.getProject()) {
    const generation = ++this.#documentGeneration;
    this.#preparation?.abort();
    const preparation = this.#preparation = new AbortController();
    const staged = this.getProject();
    staged.objects = this.canvas.getObjects().map(object => serializeObject(object as ManagedObject));
    this.#suspend = true; this.#onBusy(true);
    void (async () => {
      try {
        await prepareProjectPlots(staged, preparation.signal);
        if (generation !== this.#documentGeneration) return;
        this.refreshShapes(); this.refreshConnectors(); this.#suspend = false; this.commit();
      } catch (error) {
        if (generation !== this.#documentGeneration) return;
        this.#project = previous;
        const byId = new Map<string, ProjectObject>();
        const collect = (objects: ProjectObject[]) => objects.forEach(object => { byId.set(object.id, object); if (object.kind === 'group') collect(object.children); }); collect(previous.objects);
        this.canvas.discardActiveObject();
        for (const object of allManagedObjects(this.canvas.getObjects())) { const value = byId.get(object.obfId!); if (!value) continue; applyCommon(object, value); if (value.kind === 'plot') object.obfPlot = value.plot; object.setCoords(); }
        this.refreshShapes(); this.refreshConnectors(); this.#suspend = false; this.emit();
        this.#onError(error);
      } finally { if (generation === this.#documentGeneration) { this.#suspend = false; this.#onBusy(false); } }
    })();
  }

  private refreshShapes() {
    const staged = this.getProject();
    staged.objects = this.canvas.getObjects().map(object => serializeObject(object as ManagedObject));
    parseProject(staged);
    for (const object of allManagedObjects(this.canvas.getObjects())) {
      if (object.obfKind === 'plot' && object instanceof Group) {
        const value = serializeObject(object);
        if (value.kind === 'plot') {
          const transform = util.qrDecompose(object.calcTransformMatrix());
          const scene = updatePlotObject(object, value, this.#project.dataSources, this.#project.datasets, Math.abs(transform.scaleX), Math.abs(transform.scaleY), transform.skewX);
          if (!scene.error) value.plot.result = scene.result;
          (object as ManagedObject).obfPlot = value.plot; (object as ManagedObject).obfPlotNotices = scene.notices; (object as ManagedObject).obfPlotError = scene.error;
        }
      }
      if ((object as ManagedObject).obfKind !== "shape" || !(object instanceof Group)) continue;
      const value = serializeObject(object);
      if (value.kind === "shape") updateNativeShape(object, {
        ...value, scaleX:object.scaleX, scaleY:object.scaleY,
      });
    }
  }

  nudgeSelection(x: number, y: number) {
    const active = this.canvas.getActiveObject();
    if (!active) return;
    active.set({ left: active.left + x, top: active.top + y });
    active.setCoords();
    this.refreshConnectors();
    this.commit();
  }

  setBackground(color: string) {
    if (!isSafePaint(color)) throw new InputError("invalid_paint", "Choose a supported background color.");
    this.canvas.backgroundColor = color;
    this.canvas.requestRenderAll();
    this.commit();
  }

  deleteSelection() {
    const objects = this.canvas.getActiveObjects();
    this.canvas.discardActiveObject();
    this.canvas.remove(...objects);
    this.refreshConnectors();
    this.commit();
  }

  setTitle(title: string) {
    if (title.length > 10_000) throw new InputError("text_limit", "The title exceeds the supported text limit.");
    this.#project.metadata.title = title || "Untitled figure";
    this.commit();
  }

  copy() {
    this.#clipboard = this.canvas
      .getActiveObjects()
      .map((item) => serializeObject(item as ManagedObject));
  }

  async paste() {
    if (!this.#clipboard.length) return;
    const generation = this.#documentGeneration;
    const ids = new Map<string, string>();
    const renew = (item: ProjectObject) => {
      const oldId = item.id;
      item.id = newId();
      ids.set(oldId, item.id);
      if (item.kind === "group") item.children.forEach(renew);
    };
    const copies = this.#clipboard.map(item => {
      const copy = structuredClone(item);
      copy.x += 18;
      copy.y += 18;
      renew(copy);
      return copy;
    });
    const remap = (item: ProjectObject) => {
      if (item.kind === "connector") {
        if (item.start && ids.has(item.start.objectId)) item.start.objectId = ids.get(item.start.objectId)!;
        if (item.end && ids.has(item.end.objectId)) item.end.objectId = ids.get(item.end.objectId)!;
      }
      if (item.kind === "group") item.children.forEach(remap);
    };
    copies.forEach(remap);
    parseProject({...this.#project, objects: [...this.#project.objects, ...copies]});
    const created = await Promise.all(
      copies.map((item) =>
        objectFromProject(item, this.#project.assets, this.#project.media, this.#project.dataSources, this.#project.datasets),
      ),
    );
    if (generation !== this.#documentGeneration) return;
    this.canvas.add(...created);
    this.refreshConnectors();
    const active =
      created.length === 1
        ? created[0]
        : new ActiveSelection(created, { canvas: this.canvas });
    if (active) this.canvas.setActiveObject(active);
    this.canvas.requestRenderAll();
    this.commit();
  }

  async duplicate() {
    this.copy();
    await this.paste();
  }

  group() {
    const active = this.canvas.getActiveObject();
    if (!(active instanceof ActiveSelection)) return;
    const objects = active.getObjects();
    this.canvas.discardActiveObject();
    this.canvas.remove(...objects);
    const group = tag(
      new Group(objects, { originX: "center", originY: "center" }),
      "group",
      "Group",
    );
    this.canvas.add(group);
    this.refreshConnectors();
    this.canvas.setActiveObject(group);
    this.canvas.requestRenderAll();
    this.commit();
  }

  ungroup() {
    const active = this.canvas.getActiveObject();
    if (
      !(active instanceof Group) ||
      (active as ManagedObject).obfKind !== "group"
    )
      return;
    const children = active.getObjects();
    this.canvas.discardActiveObject();
    active.remove(...children);
    this.canvas.remove(active);
    this.canvas.add(...children);
    this.refreshConnectors();
    this.canvas.setActiveObject(
      new ActiveSelection(children, { canvas: this.canvas }),
    );
    this.canvas.requestRenderAll();
    this.commit();
  }

  arrange(action: "forward" | "backward" | "front" | "back") {
    const object = this.canvas.getActiveObject();
    if (!object) return;
    if (action === "forward") this.canvas.bringObjectForward(object);
    if (action === "backward") this.canvas.sendObjectBackwards(object);
    if (action === "front") this.canvas.bringObjectToFront(object);
    if (action === "back") this.canvas.sendObjectToBack(object);
    this.canvas.requestRenderAll();
    this.commit();
  }

  moveLayer(id: string, direction: "up" | "down") {
    const objects = this.canvas.getObjects();
    const object = objects.find((item) => (item as ManagedObject).obfId === id);
    if (!object) return;
    const index = objects.indexOf(object);
    const target = Math.max(
      0,
      Math.min(objects.length - 1, index + (direction === "up" ? 1 : -1)),
    );
    this.canvas.moveObjectTo(object, target);
    this.canvas.requestRenderAll();
    this.commit();
  }

  toggleLayer(id: string, field: "visible" | "locked") {
    const object = this.canvas
      .getObjects()
      .find((item) => (item as ManagedObject).obfId === id);
    if (!object) return;
    if (field === "visible") {
      object.visible = !object.visible;
      if (!object.visible && this.canvas.getActiveObject() === object)
        this.canvas.discardActiveObject();
    } else {
      const locked = object.selectable;
      object.set({
        selectable: !locked,
        evented: !locked,
        lockMovementX: locked,
        lockMovementY: locked,
      });
      if (locked) this.canvas.discardActiveObject();
    }
    this.canvas.requestRenderAll();
    this.commit();
  }

  align(mode: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    const objects = this.canvas.getActiveObjects();
    if (objects.length < 2) return;
    const boxes = objects.map((object) => object.getBoundingRect());
    const left = Math.min(...boxes.map((box) => box.left));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    for (const object of objects) {
      const box = object.getBoundingRect();
      if (mode === "left") object.left += left - box.left;
      if (mode === "right") object.left += right - (box.left + box.width);
      if (mode === "center")
        object.left += (left + right) / 2 - (box.left + box.width / 2);
      if (mode === "top") object.top += top - box.top;
      if (mode === "bottom") object.top += bottom - (box.top + box.height);
      if (mode === "middle")
        object.top += (top + bottom) / 2 - (box.top + box.height / 2);
      object.setCoords();
    }
    this.canvas.requestRenderAll();
    this.commit();
  }

  distribute(axis: "horizontal" | "vertical") {
    const objects = [...this.canvas.getActiveObjects()];
    if (objects.length < 3) return;
    objects.sort((a, b) =>
      axis === "horizontal" ? a.left - b.left : a.top - b.top,
    );
    const first = axis === "horizontal" ? objects[0]!.left : objects[0]!.top;
    const last =
      axis === "horizontal" ? objects.at(-1)!.left : objects.at(-1)!.top;
    objects.forEach((object, index) => {
      const next = first + ((last - first) * index) / (objects.length - 1);
      object.set(axis === "horizontal" ? "left" : "top", next);
      object.setCoords();
    });
    this.canvas.requestRenderAll();
    this.commit();
  }

  getSvg() {
    return this.canvas.toSVG();
  }

  getPng(scale: number) {
    assertPngDimensions(this.#project.document.width, this.#project.document.height, scale);
    return this.canvas.toDataURL({ format: "png", multiplier: scale });
  }
}
