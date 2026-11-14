import { drawingGeometry, type ShapeGeometry } from "./drawingml";
import { DRAWING_PRESETS } from "./presetData";

// Stable project IDs map to pinned Apache POI DrawingML presets.
// Source, license and adaptation details: docs/SHAPE_GEOMETRY.md.
export const SHAPE_DEFINITIONS = [
  { id: "rectangle", name: "Rectangle", category: "Basic", preset: "rect", width: 168, height: 112 },
  { id: "rounded-rectangle", name: "Rounded rectangle", category: "Basic", preset: "roundRect", width: 168, height: 112 },
  { id: "ellipse", name: "Ellipse", category: "Basic", preset: "ellipse", width: 160, height: 112 },
  { id: "triangle", name: "Triangle", category: "Basic", preset: "triangle", width: 136, height: 120 },
  { id: "right-triangle", name: "Right triangle", category: "Basic", preset: "rtTriangle", width: 136, height: 120 },
  { id: "diamond", name: "Diamond", category: "Basic", preset: "diamond", width: 140, height: 120 },
  { id: "pentagon", name: "Pentagon", category: "Basic", preset: "pentagon", width: 132, height: 126 },
  { id: "hexagon", name: "Hexagon", category: "Basic", preset: "hexagon", width: 144, height: 124 },
  { id: "octagon", name: "Octagon", category: "Basic", preset: "octagon", width: 128, height: 128 },
  { id: "trapezoid", name: "Trapezoid", category: "Basic", preset: "trapezoid", width: 156, height: 112 },
  { id: "parallelogram", name: "Parallelogram", category: "Basic", preset: "parallelogram", width: 164, height: 104 },
  { id: "five-point-star", name: "Five-point star", category: "Basic", preset: "star5", width: 136, height: 130 },
  { id: "eight-point-star", name: "Eight-point star", category: "Basic", preset: "star8", width: 132, height: 132 },
  { id: "cross", name: "Cross", category: "Basic", preset: "plus", width: 128, height: 128 },
  { id: "heart", name: "Heart", category: "Basic", preset: "heart", width: 136, height: 128 },
  { id: "pie", name: "Pie", category: "Basic", preset: "pie", width: 136, height: 136 },
  { id: "arc", name: "Arc", category: "Basic", preset: "arc", width: 156, height: 78 },
  { id: "donut", name: "Donut", category: "Basic", preset: "donut", width: 136, height: 136 },
  { id: "right-arrow", name: "Right block arrow", category: "Block arrows", preset: "rightArrow", width: 184, height: 80 },
  { id: "left-arrow", name: "Left block arrow", category: "Block arrows", preset: "leftArrow", width: 184, height: 80 },
  { id: "up-arrow", name: "Up block arrow", category: "Block arrows", preset: "upArrow", width: 80, height: 184 },
  { id: "down-arrow", name: "Down block arrow", category: "Block arrows", preset: "downArrow", width: 80, height: 184 },
  { id: "double-arrow", name: "Double block arrow", category: "Block arrows", preset: "leftRightArrow", width: 208, height: 88 },
  { id: "vertical-double-arrow", name: "Vertical double arrow", category: "Block arrows", preset: "upDownArrow", width: 88, height: 208 },
  { id: "chevron", name: "Chevron", category: "Block arrows", preset: "chevron", width: 112, height: 112 },
  { id: "notched-arrow", name: "Notched arrow", category: "Block arrows", preset: "notchedRightArrow", width: 184, height: 80 },
  { id: "bent-arrow", name: "Bent arrow", category: "Block arrows", preset: "bentArrow", width: 144, height: 132 },
  { id: "u-turn-arrow", name: "U-turn arrow", category: "Block arrows", preset: "uturnArrow", width: 136, height: 152 },
  { id: "curved-arrow", name: "Curved arrow", category: "Block arrows", preset: "swooshArrow", width: 156, height: 120 },
  { id: "circular-arrow", name: "Circular arrow", category: "Block arrows", preset: "circularArrow", width: 152, height: 152 },
  { id: "split-arrow", name: "Split arrow", category: "Block arrows", preset: "leftRightUpArrow", width: 156, height: 132 },
  { id: "inhibition-arrow", name: "Inhibition arrow", category: "Block arrows", preset: "", width: 184, height: 72 },
  { id: "process", name: "Process", category: "Flowchart", preset: "flowChartProcess", width: 176, height: 104 },
  { id: "decision", name: "Decision", category: "Flowchart", preset: "flowChartDecision", width: 156, height: 128 },
  { id: "terminator", name: "Terminator", category: "Flowchart", preset: "flowChartTerminator", width: 176, height: 80 },
  { id: "input-output", name: "Input / output", category: "Flowchart", preset: "flowChartInputOutput", width: 176, height: 104 },
  { id: "document", name: "Document", category: "Flowchart", preset: "flowChartDocument", width: 176, height: 128 },
  { id: "database", name: "Database", category: "Flowchart", preset: "flowChartMagneticDisk", width: 136, height: 156 },
  { id: "rect-callout", name: "Rectangular callout", category: "Callouts", preset: "wedgeRectCallout", width: 180, height: 136 },
  { id: "round-callout", name: "Rounded callout", category: "Callouts", preset: "wedgeRoundRectCallout", width: 180, height: 136 },
  { id: "oval-callout", name: "Oval callout", category: "Callouts", preset: "wedgeEllipseCallout", width: 180, height: 136 },
  { id: "speech-bubble", name: "Speech bubble", category: "Callouts", preset: "wedgeRoundRectCallout", width: 180, height: 136 },
  { id: "thought-bubble", name: "Thought bubble", category: "Callouts", preset: "cloudCallout", width: 184, height: 144 },
  { id: "bracket", name: "Bracket", category: "Callouts", preset: "leftBracket", width: 28, height: 144 },
  { id: "brace", name: "Brace", category: "Callouts", preset: "leftBrace", width: 36, height: 144 },
] as const;

export type ShapeId = (typeof SHAPE_DEFINITIONS)[number]["id"];
export const SHAPE_IDS = SHAPE_DEFINITIONS.map(shape => shape.id) as [ShapeId, ...ShapeId[]];
export const findShape = (id: string) => SHAPE_DEFINITIONS.find(shape => shape.id === id);
const ADJUSTABLE_SHAPES = new Set<ShapeId>([
  "rounded-rectangle", "five-point-star", "eight-point-star",
  "right-arrow", "left-arrow", "up-arrow", "down-arrow", "double-arrow",
  "vertical-double-arrow", "notched-arrow",
]);
export const isAdjustableShape = (id: ShapeId) => ADJUSTABLE_SHAPES.has(id);


export const SHAPE_STYLE = { fill: "#E8EFF6", stroke: "#344A60", strokeWidth: 2 } as const;

export function shapeGeometry(id: ShapeId, adjustment = 0.4, width = 100, height = 100): ShapeGeometry {
  const definition = findShape(id)!;
  const a = Math.min(0.85, Math.max(0.15, adjustment));
  // Inhibition is a scientific T-bar, not an Office block-arrow preset.
  if (id === "inhibition-arrow") return {
    paths: [{ d: `M 0 ${height/2} L ${width} ${height/2} M ${width} 0 L ${width} ${height}`, fill: false, stroke: true }],
    textRect: {x:0,y:0,width:width*0.85,height:height*0.4},
  };
  const preset = DRAWING_PRESETS[definition.preset];
  if (!preset) throw new Error(`Missing bundled shape preset: ${definition.preset}`);
  const adjustments: Record<string, number> = {};
  // Preserve the upstream default at 40%, without letting the slider collapse
  // star points or make arrow shafts as wide as their heads at either extreme.
  const adjusted = (min: number, normal: number, max: number) => a <= 0.4
    ? min + (normal-min) * (a-0.15)/0.25 : normal + (max-normal) * (a-0.4)/0.45;
  if (id === "rounded-rectangle") adjustments.adj = adjusted(5000,16667,42000);
  if (id === "five-point-star") adjustments.adj = adjusted(8000,19098,40000);
  if (id === "eight-point-star") adjustments.adj = adjusted(15000,37500,46000);
  if (id.includes("arrow") && isAdjustableShape(id)) adjustments.adj1 = adjusted(20000,50000,85000);
  if (id === "arc") { adjustments.adj1 = 10800000; adjustments.adj2 = 0; }
  if (id === "circular-arrow") adjustments.adj4 = 5400000;
  if (id === "brace") adjustments.adj1 = 25000;
  if (id === "speech-bubble") { adjustments.adj1 = 28000; adjustments.adj2 = 62500; }
  // Office callout tails extend beyond their body rectangle. Reserve space in
  // the native object frame, so previews and selection bounds include the tail.
  const bodyHeight = definition.category === "Callouts" && !["bracket","brace"].includes(id) ? height / 1.2
    : id === "arc" ? height * 2 : height;
  const geometry = drawingGeometry(preset, width, bodyHeight, adjustments);
  if (["arc","bracket","brace"].includes(id)) {
    geometry.paths = geometry.paths.filter(path => path.stroke).map(path => ({...path,fill:false}));
  }
  return geometry;
}

// For path-only consumers. Rendering uses shapeGeometry to retain separate
// fill and outline layers (database rims, curved arrows and open brackets).
export function shapePath(id: ShapeId, adjustment = 0.4): string {
  return shapeGeometry(id, adjustment).paths.map(path => path.d).join(" ");
}
