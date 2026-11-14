import { Circle, FixedLayout, Group, LayoutManager, Line, Path, Rect, Text, util } from 'fabric';
import type { ProjectObject } from '../domain/project/schema';
import type { DataSource, Dataset } from '../domain/data/schema';
import { buildPlotScene, type PlotScene, type MeasureText } from '../domain/plots/scene';

export type PlotObject = Extract<ProjectObject, { kind: 'plot' }>;
let textContext: CanvasRenderingContext2D | null | undefined;
const measure: MeasureText = (text, size, family) => {
  const context = textContext ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * size * 0.6;
  context.font = `${size}px ${family}`; return context.measureText(text).width;
};
export function createPlotObject(value: PlotObject, sources: DataSource[], datasets: Dataset[], scaleX = value.scaleX, scaleY = value.scaleY, skewX = 0): { group: Group; scene: PlotScene } {
  const group = new Group([], { width: value.width, height: value.height, originX: 'center', originY: 'center', subTargetCheck: false, layoutManager: new LayoutManager(new FixedLayout()) });
  return { group, scene: updatePlotObject(group, value, sources, datasets, scaleX, scaleY, skewX) };
}
export function updatePlotObject(group: Group, value: PlotObject, sources: DataSource[], datasets: Dataset[], effectiveScaleX = value.scaleX, effectiveScaleY = value.scaleY, effectiveSkewX = 0): PlotScene {
  const dataset = datasets.find(dataset => dataset.id === value.plot.datasetId), source = sources.find(source => source.id === dataset?.sourceId);
  const sx = Math.max(0.001, effectiveScaleX), sy = Math.max(0.001, effectiveScaleY);
  const scene = buildPlotScene(source, dataset, value.plot, value.width * sx, value.height * sy, measure);
  const children = scene.primitives.map((primitive, index) => {
    const defaults = { selectable: false, evented: false, strokeUniform: true, originX: 'left' as const, originY: 'top' as const };
    let object: Circle | Line | Path | Rect | Text, x: number, y: number;
    if (primitive.kind === 'rect') { object = new Rect({ ...defaults, width: primitive.width, height: primitive.height, fill: index === 0 && value.fill ? value.fill : primitive.fill, stroke: index === 0 && value.stroke ? value.stroke : primitive.stroke, strokeWidth: index === 0 && value.stroke ? value.strokeWidth : primitive.stroke ? 1 : 0 }); x = primitive.x; y = primitive.y; }
    else if (primitive.kind === 'line') { object = new Line([primitive.x1, primitive.y1, primitive.x2, primitive.y2], { ...defaults, stroke: primitive.stroke, strokeWidth: primitive.strokeWidth ?? 1 }); x = Math.min(primitive.x1, primitive.x2); y = Math.min(primitive.y1, primitive.y2); }
    else if (primitive.kind === 'circle') { object = new Circle({ ...defaults, radius: primitive.radius, fill: primitive.fill, opacity: primitive.opacity ?? 1, strokeWidth: 0 }); x = primitive.x - primitive.radius; y = primitive.y - primitive.radius; }
    else if (primitive.kind === 'path') { object = new Path(primitive.d, { ...defaults, fill: primitive.fill, stroke: primitive.stroke, strokeWidth: primitive.stroke ? 1 : 0, opacity: primitive.opacity ?? 1 }); x = object.pathOffset.x - object.width / 2; y = object.pathOffset.y - object.height / 2; }
    else { object = new Text(primitive.text, { ...defaults, fontFamily: value.plot.appearance.fontFamily, fontSize: primitive.size, fill: primitive.fill, angle: primitive.angle ?? 0, strokeWidth: 0, originX: primitive.anchor === 'middle' ? 'center' : primitive.anchor === 'end' ? 'right' : 'left', originY: 'bottom' }); x = primitive.x; y = primitive.y; }
    return { object, x, y };
  });
  group.remove(...group.getObjects()); group.add(...children.map(child => child.object));
  // Undo the complete inherited stretch/shear while retaining the plot's world rotation.
  const shear = Math.tan(effectiveSkewX * Math.PI / 180);
  children.forEach(({ object, x, y }) => {
    const angle = object.angle * Math.PI / 180, cos = util.cos(angle), sin = util.sin(angle);
    const transform = util.qrDecompose([cos / sx - shear * sin / sy, sin / sy, -sin / sx - shear * cos / sy, cos / sy, 0, 0]);
    const centeredX = x - scene.width / 2, centeredY = y - scene.height / 2;
    object.set({ left: centeredX / sx - shear * centeredY / sy, top: centeredY / sy, scaleX: transform.scaleX, scaleY: transform.scaleY, angle: transform.angle, skewX: transform.skewX }); object.setCoords();
  });
  group.dirty = true; return scene;
}
