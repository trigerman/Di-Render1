import { createProject } from "../project/factory";
import type { OpenBioFigureProject, ProjectObject } from "../project/schema";

export type FigureTemplateId =
  | "experimental-workflow"
  | "comparison-panels"
  | "microscopy-grid"
  | "pathway-mechanism"
  | "treatment-timeline"
  | "graphical-abstract"
  | "cell-signaling"
  | "mouse-study"
  | "cell-culture-assay"
  | "virus-life-cycle"
  | "immune-response"
  | "crispr-editing"
  | "clinical-trial"
  | "western-blot"
  | "drug-mechanism"
  | "gene-expression"
  | "organoid-screen"
  | "six-panel-figure"
  | "research-poster";

/** A library drawing placed by a template: centre (x, y) in px and its longest side in px. */
export interface TemplateArtwork {
  assetId: string;
  x: number;
  y: number;
  size: number;
  name?: string;
}

export interface FigureTemplate {
  id: FigureTemplateId;
  title: string;
  description: string;
  width: number;
  height: number;
  preview:
    | "workflow"
    | "comparison"
    | "microscopy"
    | "pathway"
    | "timeline"
    | "abstract"
    | "panels"
    | "poster";
  /** Built-in drawings placed when the template opens (needs the library; skipped offline). */
  artwork?: TemplateArtwork[];
  /** Shown as a small tag on the template card. */
  tag?: string;
}

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: "experimental-workflow",
    title: "Experimental workflow",
    description: "Four editable steps with directional flow",
    width: 1600,
    height: 900,
    preview: "workflow",
  },
  {
    id: "comparison-panels",
    title: "Comparison A/B",
    description: "Two labeled panels for conditions or groups",
    width: 1200,
    height: 800,
    preview: "comparison",
  },
  {
    id: "microscopy-grid",
    title: "Microscopy grid",
    description: "Four labeled image panels with scale bars",
    width: 1200,
    height: 1000,
    preview: "microscopy",
  },
  {
    id: "pathway-mechanism",
    title: "Pathway mechanism",
    description: "Signal, receptor, pathway, and cellular response",
    width: 1600,
    height: 900,
    preview: "pathway",
  },
  {
    id: "treatment-timeline",
    title: "Treatment timeline",
    description: "Editable study events across a clear time axis",
    width: 1600,
    height: 900,
    preview: "timeline",
  },
  {
    id: "graphical-abstract",
    title: "Graphical abstract",
    description: "Question, method, and finding in three concise stages",
    width: 1800,
    height: 1000,
    preview: "abstract",
  },
  {
    id: "cell-signaling",
    title: "Cell signaling pathway",
    description: "Ligand, membrane receptor, kinase cascade and nucleus",
    width: 1600,
    height: 900,
    preview: "pathway",
    tag: "Illustrated",
    artwork: [
      { assetId: "reactome-r-ico-012954-ligand-01", x: 520, y: 195, size: 70, name: "Ligand" },
      { assetId: "biodraws-gpcr", x: 520, y: 330, size: 190, name: "Receptor" },
      { assetId: "biodraws-protein-kinase-a", x: 860, y: 470, size: 130, name: "Kinase 1" },
      { assetId: "biodraws-protein-kinase-c", x: 1150, y: 470, size: 130, name: "Kinase 2" },
      { assetId: "nih-bioart-126-dna-629426", x: 1180, y: 705, size: 170, name: "Target gene" },
    ],
  },
  {
    id: "mouse-study",
    title: "In vivo study design",
    description: "Animals, treatment, tissue harvest and analysis",
    width: 1600,
    height: 900,
    preview: "workflow",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-280-lab-mouse-631486", x: 215, y: 440, size: 125, name: "Mouse (control)" },
      { assetId: "nih-bioart-279-lab-mouse-631481", x: 305, y: 500, size: 125, name: "Mouse (treated)" },
      { assetId: "nih-bioart-505-syringe-636184", x: 620, y: 460, size: 170, name: "Treatment" },
      { assetId: "servier-human-physiology-liver-512745aa", x: 965, y: 445, size: 165, name: "Harvested organ" },
      { assetId: "nih-bioart-488-scissors-636052", x: 1050, y: 545, size: 70, name: "Dissection" },
      { assetId: "servier-lab-apparatus-microscope-f69c9515", x: 1340, y: 455, size: 190, name: "Analysis" },
    ],
  },
  {
    id: "cell-culture-assay",
    title: "Cell culture assay",
    description: "Seed, treat, plate, read out and analyze",
    width: 1800,
    height: 800,
    preview: "workflow",
    tag: "Illustrated",
    artwork: [
      { assetId: "bioicons-lab-apparatus-marcel-tisch-t75-flask-5470eb19", x: 200, y: 400, size: 170, name: "Culture flask" },
      { assetId: "nih-bioart-408-pipette-633344", x: 550, y: 400, size: 190, name: "Treatment" },
      { assetId: "nih-bioart-7-96-well-plate-626593", x: 900, y: 400, size: 200, name: "96-well plate" },
      { assetId: "nih-bioart-426-qpcr-machine-633949", x: 1250, y: 400, size: 190, name: "Readout" },
      { assetId: "nih-bioart-721-area-chart-graph-789287", x: 1600, y: 400, size: 170, name: "Results" },
    ],
  },
  {
    id: "virus-life-cycle",
    title: "Virus life cycle",
    description: "Attachment, entry, replication, assembly and release",
    width: 1400,
    height: 1000,
    preview: "abstract",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-967-virus-803698", x: 250, y: 230, size: 120, name: "Virion" },
      { assetId: "nih-bioart-967-virus-803698", x: 430, y: 390, size: 75, name: "Entering virion" },
      { assetId: "nih-bioart-452-rna-634859", x: 700, y: 610, size: 150, name: "Viral genome" },
      { assetId: "nih-bioart-967-virus-803698", x: 960, y: 420, size: 75, name: "New virion" },
      { assetId: "nih-bioart-967-virus-803698", x: 1160, y: 230, size: 120, name: "Released virion" },
    ],
  },
  {
    id: "immune-response",
    title: "Adaptive immune response",
    description: "Antigen presentation, T and B cell activation, antibodies",
    width: 1600,
    height: 900,
    preview: "pathway",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-112-dendritic-cell-628926", x: 220, y: 420, size: 210, name: "Dendritic cell" },
      { assetId: "nih-bioart-509-t-cell-636314", x: 520, y: 420, size: 150, name: "Helper T cell" },
      { assetId: "reactome-r-ico-012460-b-cell", x: 820, y: 420, size: 150, name: "B cell" },
      { assetId: "reactome-r-ico-013187-plasma-cell", x: 1110, y: 420, size: 160, name: "Plasma cell" },
      { assetId: "nih-bioart-17-antibody-626830", x: 1380, y: 380, size: 90, name: "Antibody" },
      { assetId: "nih-bioart-17-antibody-626830", x: 1460, y: 460, size: 90, name: "Antibody" },
      { assetId: "nih-bioart-877-macrophage-798479", x: 800, y: 730, size: 150, name: "Macrophage" },
    ],
  },
  {
    id: "crispr-editing",
    title: "CRISPR gene editing",
    description: "Cas9 and guide RNA, double-strand break, NHEJ or HDR repair",
    width: 1600,
    height: 900,
    preview: "pathway",
    tag: "Illustrated",
    artwork: [
      { assetId: "bioicons-genetics-marcel-tisch-crispr-cas9-f328eaec", x: 270, y: 430, size: 220, name: "Cas9" },
      { assetId: "reactome-r-ico-012799-grna", x: 380, y: 320, size: 110, name: "Guide RNA" },
      { assetId: "reactome-r-ico-012629-dna", x: 720, y: 430, size: 260, name: "Target locus" },
      { assetId: "reactome-r-ico-012629-dna", x: 1160, y: 270, size: 170, name: "Knockout allele" },
      { assetId: "reactome-r-ico-012629-dna", x: 1160, y: 610, size: 170, name: "Knock-in allele" },
      { assetId: "bioicons-cell-culture-marcel-tisch-stem-cell-colony-5c1cd0db", x: 1460, y: 440, size: 180, name: "Edited cells" },
    ],
  },
  {
    id: "clinical-trial",
    title: "Randomized clinical trial",
    description: "Enrollment, randomization, two arms, follow-up and outcome",
    width: 1800,
    height: 900,
    preview: "timeline",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-923-person-801148", x: 170, y: 450, size: 150, name: "Participant" },
      { assetId: "nih-bioart-924-person-801209", x: 280, y: 450, size: 150, name: "Participant" },
      { assetId: "nih-bioart-407-pill-633289", x: 900, y: 265, size: 100, name: "Study drug" },
      { assetId: "nih-bioart-962-vial-empty-803518", x: 900, y: 625, size: 110, name: "Placebo" },
      { assetId: "nih-bioart-206-hospital-setting-630533", x: 1260, y: 450, size: 230, name: "Follow-up" },
      { assetId: "nih-bioart-721-area-chart-graph-789287", x: 1600, y: 450, size: 180, name: "Outcome" },
    ],
  },
  {
    id: "western-blot",
    title: "Western blot workflow",
    description: "Cells, lysis, SDS-PAGE, transfer and detection",
    width: 1800,
    height: 700,
    preview: "workflow",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-404-petri-dish-633269", x: 180, y: 340, size: 170, name: "Cells" },
      { assetId: "servier-lab-apparatus-centrifuge-d99a3468", x: 540, y: 340, size: 180, name: "Lysis" },
      { assetId: "nih-bioart-581-western-blot-gel-653079", x: 900, y: 340, size: 170, name: "SDS-PAGE" },
      { assetId: "nih-bioart-580-western-blot-transfer-device-653073", x: 1260, y: 340, size: 180, name: "Transfer" },
      { assetId: "bioicons-general-items-pooja-western-two-a2917fb5", x: 1620, y: 340, size: 170, name: "Detection" },
    ],
  },
  {
    id: "drug-mechanism",
    title: "Drug mechanism of action",
    description: "Drug, receptor, inhibited kinase, tumor cell and apoptosis",
    width: 1600,
    height: 900,
    preview: "pathway",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-407-pill-633289", x: 330, y: 160, size: 110, name: "Drug" },
      { assetId: "biodraws-gpcr", x: 560, y: 300, size: 170, name: "Target receptor" },
      { assetId: "biodraws-protein-kinase-a", x: 930, y: 470, size: 130, name: "Oncogenic kinase" },
      { assetId: "reactome-r-ico-014264-tumor-cell", x: 1250, y: 470, size: 150, name: "Tumor cell" },
      { assetId: "nih-bioart-21-apoptosis-626925", x: 1250, y: 760, size: 160, name: "Apoptosis" },
    ],
  },
  {
    id: "gene-expression",
    title: "Gene expression",
    description: "DNA, transcription, mRNA, translation and protein",
    width: 1600,
    height: 700,
    preview: "workflow",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-126-dna-629426", x: 250, y: 360, size: 200, name: "Gene" },
      { assetId: "reactome-r-ico-013027-mrna", x: 640, y: 360, size: 190, name: "mRNA" },
      { assetId: "nih-bioart-448-ribosome-634694", x: 1000, y: 355, size: 170, name: "Ribosome" },
      { assetId: "nih-bioart-765-signaling-protein-792463", x: 1350, y: 360, size: 150, name: "Protein" },
    ],
  },
  {
    id: "organoid-screen",
    title: "Organoid drug screen",
    description: "Stem cells, organoid culture, screening plate and imaging",
    width: 1800,
    height: 800,
    preview: "workflow",
    tag: "Illustrated",
    artwork: [
      { assetId: "nih-bioart-931-pluripotent-intestinal-crypt-stem-cell-801628", x: 200, y: 400, size: 160, name: "Stem cell" },
      { assetId: "nih-bioart-399-organoid-633184", x: 550, y: 400, size: 190, name: "Organoid" },
      { assetId: "nih-bioart-536-vaccine-vial-636859", x: 880, y: 380, size: 110, name: "Compound library" },
      { assetId: "nih-bioart-7-96-well-plate-626593", x: 960, y: 470, size: 150, name: "Screening plate" },
      { assetId: "servier-lab-apparatus-microscope-f69c9515", x: 1250, y: 400, size: 190, name: "Imaging" },
      { assetId: "nih-bioart-721-area-chart-graph-789287", x: 1600, y: 400, size: 170, name: "Dose response" },
    ],
  },
  {
    id: "six-panel-figure",
    title: "Six-panel figure",
    description: "A–F grid for images, plots and schematics",
    width: 1500,
    height: 1000,
    preview: "panels",
    tag: "Layout",
  },
  {
    id: "research-poster",
    title: "Research poster",
    description: "Portrait poster with title bar and five sections",
    width: 1800,
    height: 2400,
    preview: "poster",
    tag: "Layout",
    artwork: [
      { assetId: "bioicons-lab-apparatus-marcel-tisch-t75-flask-5470eb19", x: 230, y: 1300, size: 150, name: "Method 1" },
      { assetId: "nih-bioart-408-pipette-633344", x: 470, y: 1300, size: 160, name: "Method 2" },
      { assetId: "servier-lab-apparatus-microscope-f69c9515", x: 710, y: 1300, size: 170, name: "Method 3" },
      { assetId: "nih-bioart-721-area-chart-graph-789287", x: 1330, y: 800, size: 320, name: "Key result" },
    ],
  },
];

const newId = () => globalThis.crypto.randomUUID();

const common = (
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
) => ({
  id: newId(),
  name,
  x,
  y,
  width,
  height,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  opacity: 1,
  visible: true,
  locked: false,
  fill: "#ffffff",
  stroke: "#35545a",
  strokeWidth: 2,
});

function rect(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = "#ffffff",
): ProjectObject {
  return { ...common(name, x, y, width, height), kind: "rect", fill };
}

function ellipse(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = "#dff4f5",
): ProjectObject {
  return { ...common(name, x, y, width, height), kind: "ellipse", fill };
}

function text(
  name: string,
  value: string,
  x: number,
  y: number,
  fontSize = 26,
  width = Math.max(80, value.length * fontSize * 0.62),
): ProjectObject {
  return {
    ...common(name, x, y, width, fontSize * 1.3),
    kind: "text",
    text: value,
    fill: "#263238",
    stroke: null,
    strokeWidth: 0,
    fontFamily: "IBM Plex Sans",
    fontSize,
    fontWeight: name === "Figure title" ? 600 : 500,
    textAlign: "center",
  };
}

function arrow(
  name: string,
  x: number,
  y: number,
  width: number,
): ProjectObject {
  return {
    ...common(name, x, y, width, 3),
    kind: "arrow",
    fill: "#35545a",
    stroke: "#35545a",
    strokeWidth: 3,
    points: [0, 1.5, width, 1.5],
  };
}

function line(
  name: string,
  x: number,
  y: number,
  width: number,
  stroke = "#ffffff",
): ProjectObject {
  return {
    ...common(name, x, y, width, 4),
    kind: "line",
    fill: null,
    stroke,
    strokeWidth: 4,
    points: [0, 2, width, 2],
  };
}

function workflowObjects(): ProjectObject[] {
  const steps = ["Sample", "Prepare", "Measure", "Analyze"];
  const objects: ProjectObject[] = [
    text("Figure title", "Experimental workflow", 800, 105, 42),
  ];
  steps.forEach((label, index) => {
    const x = 245 + index * 370;
    objects.push(ellipse(`${label} step`, x, 420, 220, 150));
    objects.push(text(`${label} label`, label, x, 420, 25));
    objects.push(
      text(`${label} caption`, "Add method detail", x, 555, 18, 210),
    );
    if (index < steps.length - 1)
      objects.push(arrow(`Step ${index + 1} connector`, x + 190, 420, 130));
  });
  return objects;
}

function comparisonObjects(): ProjectObject[] {
  return [
    text("Figure title", "Condition comparison", 600, 70, 38),
    rect("Panel A", 320, 390, 500, 520, "#f7fafb"),
    rect("Panel B", 880, 390, 500, 520, "#f7fafb"),
    text("Panel A label", "A", 95, 155, 32),
    text("Panel B label", "B", 655, 155, 32),
    text("Condition A", "Control", 320, 180, 25),
    text("Condition B", "Treatment", 880, 180, 25),
    ellipse("Control placeholder", 320, 390, 190, 190),
    ellipse("Treatment placeholder", 880, 390, 190, 190, "#fae8c8"),
    text("Panel A caption", "Add observation", 320, 620, 18),
    text("Panel B caption", "Add observation", 880, 620, 18),
  ];
}

function microscopyObjects(): ProjectObject[] {
  const objects: ProjectObject[] = [
    text("Figure title", "Microscopy figure", 600, 58, 36),
  ];
  const panels = [
    ["A", 325, 300],
    ["B", 875, 300],
    ["C", 325, 740],
    ["D", 875, 740],
  ] as const;
  panels.forEach(([label, x, y]) => {
    objects.push(rect(`Panel ${label}`, x, y, 500, 380, "#263238"));
    objects.push(text(`Panel ${label} label`, label, x - 215, y - 155, 28));
    objects.push(text(`Panel ${label} placeholder`, "Image", x, y, 23));
    objects.push(line(`Panel ${label} scale bar`, x + 155, y + 145, 110));
  });
  return objects;
}

function pathwayObjects(): ProjectObject[] {
  return [
    text("Figure title", "Signaling mechanism", 800, 85, 40),
    text("Signal label", "Signal", 210, 320, 23),
    ellipse("Signal", 210, 410, 120, 120, "#fae8c8"),
    arrow("Signal to receptor", 290, 410, 180),
    rect("Receptor", 540, 410, 190, 120, "#dff4f5"),
    text("Receptor label", "Receptor", 540, 410, 23),
    arrow("Receptor to kinase", 650, 410, 150),
    ellipse("Kinase", 870, 410, 150, 110, "#e8e6f8"),
    text("Kinase label", "Kinase", 870, 410, 22),
    arrow("Kinase to response", 965, 410, 150),
    rect("Response", 1240, 410, 260, 150, "#e1f1e7"),
    text("Response label", "Cell response", 1240, 410, 23),
    text(
      "Mechanism note",
      "Add regulators, evidence, and conditions",
      800,
      675,
      19,
    ),
  ];
}

function timelineObjects(): ProjectObject[] {
  const objects: ProjectObject[] = [
    text("Figure title", "Treatment timeline", 800, 90, 40),
    line("Study timeline", 190, 450, 1220, "#35545a"),
  ];
  const events = [
    ["Baseline", "Day 0"],
    ["Dose", "Day 3"],
    ["Sample", "Day 7"],
    ["Endpoint", "Day 14"],
  ] as const;
  events.forEach(([label, time], index) => {
    const x = 260 + index * 360;
    objects.push(ellipse(`${label} marker`, x, 450, 44, 44, "#0f766e"));
    objects.push(text(`${label} label`, label, x, 350, 23));
    objects.push(text(`${label} time`, time, x, 520, 18));
    objects.push(text(`${label} note`, "Add detail", x, 590, 17));
  });
  return objects;
}

function graphicalAbstractObjects(): ProjectObject[] {
  const stages = [
    ["Question", "State the biological question", "#f7fafb"],
    ["Method", "Show the experimental approach", "#dff4f5"],
    ["Finding", "Summarize the main result", "#e1f1e7"],
  ] as const;
  const objects: ProjectObject[] = [
    text("Figure title", "Graphical abstract", 900, 85, 42),
  ];
  stages.forEach(([label, caption, fill], index) => {
    const x = 335 + index * 565;
    objects.push(rect(`${label} stage`, x, 500, 450, 620, fill));
    objects.push(text(`${label} heading`, label, x, 255, 29));
    objects.push(ellipse(`${label} visual`, x, 470, 210, 180));
    objects.push(text(`${label} caption`, caption, x, 690, 20, 360));
    if (index < stages.length - 1)
      objects.push(arrow(`${label} connector`, x + 250, 500, 100));
  });
  return objects;
}


// ---------- Illustrated and layout templates (Di-Render) ----------
const PALE = { blue: "#dff4f5", green: "#e1f1e7", sand: "#fae8c8", lilac: "#e8e6f8", grey: "#f7fafb", membrane: "#f6e7b4" };
const rotated = (object: ProjectObject, angle: number): ProjectObject => ({ ...object, angle });
const varrow = (name: string, x: number, y: number, length: number) => rotated(arrow(name, x, y, length), 90);
function inhibition(name: string, x: number, y: number, length: number): ProjectObject[] {
  return [line(name, x, y, length, "#b42318"), rotated(line(`${name} bar`, x + length / 2, y, 40, "#b42318"), 90)];
}
function stages(labels: ReadonlyArray<readonly [string, string]>, start: number, spacing: number, y: number, w: number, h: number): ProjectObject[] {
  const fills = [PALE.grey, PALE.blue, PALE.green, PALE.sand, PALE.lilac];
  const out: ProjectObject[] = [];
  labels.forEach(([label, caption], index) => {
    const x = start + index * spacing;
    out.push(rect(`${label} stage`, x, y, w, h, fills[index % fills.length]));
    out.push(text(`${label} heading`, label, x, y - h / 2 + 40, 24));
    out.push(text(`${label} caption`, caption, x, y + h / 2 - 50, 17, w - 30));
    if (index < labels.length - 1) out.push(arrow(`${label} connector`, x + spacing / 2, y, Math.max(30, spacing - w - 16)));
  });
  return out;
}

function cellSignalingObjects(): ProjectObject[] {
  return [
    text("Figure title", "Cell signaling pathway", 800, 70, 40),
    text("Extracellular label", "Extracellular", 150, 230, 19),
    rect("Plasma membrane", 800, 330, 1500, 54, PALE.membrane),
    text("Cytoplasm label", "Cytoplasm", 150, 430, 19),
    text("Ligand label", "Ligand", 630, 190, 21),
    text("Receptor label", "Receptor", 330, 330, 21),
    arrow("Receptor to kinase 1", 700, 470, 130),
    arrow("Kinase 1 to kinase 2", 1005, 470, 110),
    text("Cascade label", "Kinase cascade", 1005, 385, 21),
    varrow("Kinase 2 to nucleus", 1150, 565, 60),
    ellipse("Nucleus", 1180, 705, 440, 250, PALE.lilac),
    text("Nucleus label", "Nucleus", 1180, 612, 19),
    text("Response label", "Gene expression", 1180, 860, 21),
    text("Editing hint", "Double-click artwork to recolour; swap icons from Assets", 520, 860, 15, 520),
  ];
}

function mouseStudyObjects(): ProjectObject[] {
  return [
    text("Figure title", "In vivo study design", 800, 75, 40),
    ...stages([["Animals", "n = 10 per group"], ["Treatment", "Daily dose for 14 days"], ["Harvest", "Tissue collection"], ["Analysis", "Histology and imaging"]], 260, 360, 470, 300, 420),
    line("Study timeline", 800, 780, 1080, "#35545a"),
    text("Day 0", "Day 0", 260, 820, 17), text("Days 1-14", "Days 1–14", 620, 820, 17),
    text("Day 15", "Day 15", 980, 820, 17), text("Day 16+", "Day 16+", 1340, 820, 17),
  ];
}

function cellCultureObjects(): ProjectObject[] {
  return [
    text("Figure title", "Cell culture assay", 900, 70, 40),
    ...stages([["Seed", "Expand cells to 80% confluence"], ["Treat", "Add compound or vehicle"], ["Plate", "96-well format, triplicates"], ["Read out", "qPCR / fluorescence"], ["Analyze", "Normalize and test"]], 200, 350, 400, 280, 420),
  ];
}

function virusObjects(): ProjectObject[] {
  return [
    text("Figure title", "Virus life cycle", 700, 60, 40),
    ellipse("Host cell", 700, 600, 980, 620, PALE.green),
    ellipse("Host nucleus", 700, 640, 300, 210, PALE.lilac),
    text("Step 1", "1 Attachment", 250, 120, 21), text("Step 2", "2 Entry", 470, 470, 19),
    text("Step 3", "3 Replication", 700, 760, 19), text("Step 4", "4 Assembly", 980, 500, 19),
    text("Step 5", "5 Release", 1160, 120, 21),
    rotated(arrow("Attachment to entry", 345, 310, 120), 40),
    rotated(arrow("Entry to replication", 560, 500, 130), 35),
    rotated(arrow("Replication to assembly", 850, 510, 130), -40),
    rotated(arrow("Assembly to release", 1065, 320, 130), -45),
  ];
}

function immuneObjects(): ProjectObject[] {
  const steps = [["Antigen presentation", 220], ["T cell activation", 520], ["B cell help", 820], ["Differentiation", 1110], ["Antibody secretion", 1420]] as const;
  const out: ProjectObject[] = [text("Figure title", "Adaptive immune response", 800, 70, 40)];
  steps.forEach(([label, x], index) => {
    out.push(text(`${label} label`, label, x, 580, 19, 260));
    if (index < steps.length - 1) out.push(arrow(`${label} connector`, x + (steps[index + 1]![1] - x) / 2, 420, 70));
  });
  out.push(text("Innate label", "Innate support: phagocytosis", 800, 840, 19, 360));
  return out;
}

function crisprObjects(): ProjectObject[] {
  return [
    text("Figure title", "CRISPR gene editing", 800, 70, 40),
    text("Complex label", "Cas9 + guide RNA", 300, 590, 20),
    arrow("Complex to locus", 500, 430, 90),
    text("Locus label", "Double-strand break", 720, 590, 20),
    rotated(arrow("Break to NHEJ", 955, 345, 170), -30),
    rotated(arrow("Break to HDR", 955, 515, 170), 30),
    text("NHEJ label", "NHEJ — knockout", 1160, 160, 20), text("HDR label", "HDR — knock-in", 1160, 730, 20),
    rotated(arrow("NHEJ to cells", 1320, 345, 90), 25), rotated(arrow("HDR to cells", 1320, 525, 90), -25),
    text("Cells label", "Edited cells", 1460, 590, 20),
  ];
}

function clinicalTrialObjects(): ProjectObject[] {
  return [
    text("Figure title", "Randomized clinical trial", 900, 70, 40),
    text("Enrollment label", "Enrollment (n = 200)", 225, 590, 20),
    arrow("Enrollment to randomization", 400, 450, 90),
    rect("Randomization", 560, 450, 220, 120, PALE.sand),
    text("Randomization label", "Randomize 1:1", 560, 450, 21),
    rotated(arrow("To arm A", 745, 360, 140), -35), rotated(arrow("To arm B", 745, 540, 140), 35),
    rect("Arm A", 900, 280, 300, 230, PALE.blue), text("Arm A label", "Arm A — study drug", 900, 360, 19),
    rect("Arm B", 900, 640, 300, 230, PALE.grey), text("Arm B label", "Arm B — placebo", 900, 720, 19),
    rotated(arrow("Arm A to follow-up", 1085, 360, 130), 30), rotated(arrow("Arm B to follow-up", 1085, 540, 130), -30),
    text("Follow-up label", "Follow-up, 12 months", 1260, 600, 20),
    arrow("Follow-up to outcome", 1430, 450, 90),
    text("Outcome label", "Primary endpoint", 1600, 590, 20),
  ];
}

function westernBlotObjects(): ProjectObject[] {
  return [
    text("Figure title", "Western blot workflow", 900, 60, 38),
    ...stages([["Cells", "Treat and harvest"], ["Lysis", "Lyse, spin, quantify"], ["SDS-PAGE", "Separate by size"], ["Transfer", "Membrane blotting"], ["Detection", "Primary + secondary"]], 180, 360, 360, 300, 420),
  ];
}

function drugMechanismObjects(): ProjectObject[] {
  return [
    text("Figure title", "Drug mechanism of action", 800, 60, 40),
    rect("Plasma membrane", 800, 300, 1500, 50, PALE.membrane),
    text("Drug label", "Drug", 450, 150, 21),
    rotated(arrow("Drug binds receptor", 440, 235, 110), 40),
    text("Receptor label", "Target receptor", 560, 410, 19),
    ...inhibition("Receptor inhibits kinase", 760, 470, 150),
    text("Kinase label", "Oncogenic kinase", 930, 560, 19),
    arrow("Kinase to tumor cell", 1090, 470, 110),
    text("Tumor label", "Proliferation ↓", 1430, 470, 19),
    varrow("Tumor to apoptosis", 1250, 610, 80),
    text("Apoptosis label", "Apoptosis", 1430, 760, 19),
  ];
}

function geneExpressionObjects(): ProjectObject[] {
  return [
    text("Figure title", "Gene expression", 800, 60, 40),
    ellipse("Nucleus", 420, 360, 640, 400, PALE.lilac), text("Nucleus label", "Nucleus", 420, 195, 19),
    arrow("Transcription", 445, 360, 120), text("Transcription label", "Transcription", 445, 300, 18),
    arrow("Export and translation", 820, 360, 120), text("Translation label", "Translation", 820, 300, 18),
    arrow("Folding", 1175, 360, 110), text("Folding label", "Folding", 1175, 300, 18),
    text("Gene label", "Gene", 250, 500, 19), text("mRNA label", "mRNA", 640, 500, 19),
    text("Ribosome label", "Ribosome", 1000, 500, 19), text("Protein label", "Functional protein", 1350, 500, 19),
  ];
}

function organoidObjects(): ProjectObject[] {
  return [
    text("Figure title", "Organoid drug screen", 900, 70, 40),
    ...stages([["Stem cells", "Isolate crypts"], ["Organoids", "3D matrix culture, 7 days"], ["Screen", "Compound library, 96-well"], ["Imaging", "High-content microscopy"], ["Analysis", "Viability, IC50"]], 200, 350, 400, 280, 420),
  ];
}

function sixPanelObjects(): ProjectObject[] {
  const out: ProjectObject[] = [text("Figure title", "Figure 1", 750, 50, 34)];
  "ABCDEF".split("").forEach((label, index) => {
    const x = 270 + (index % 3) * 480, y = 320 + Math.floor(index / 3) * 450;
    out.push(rect(`Panel ${label}`, x, y, 440, 400, PALE.grey));
    out.push(text(`Panel ${label} letter`, label, x - 195, y - 175, 30, 40));
    out.push(text(`Panel ${label} placeholder`, "Image, plot or schematic", x, y, 18, 300));
  });
  return out;
}

function posterObjects(): ProjectObject[] {
  const section = (name: string, x: number, y: number, w: number, h: number, fill: string, body: string): ProjectObject[] => [
    rect(`${name} section`, x, y, w, h, fill),
    text(`${name} heading`, name, x, y - h / 2 + 55, 44, w - 60),
    text(`${name} body`, body, x, y - h / 2 + 130, 26, w - 80),
  ];
  return [
    rect("Title bar", 900, 170, 1700, 260, PALE.blue),
    text("Figure title", "Poster title: one clear finding", 900, 130, 64, 1600),
    text("Authors", "Author One, Author Two, Author Three · Institution", 900, 220, 28, 1500),
    ...section("Introduction", 470, 640, 800, 520, PALE.grey, "Background and the question in two or three sentences."),
    ...section("Methods", 470, 1290, 800, 680, PALE.green, "Model, approach and key measurements."),
    ...section("Results", 1330, 960, 800, 1100, PALE.grey, "Main figure, effect sizes and statistics."),
    ...section("Conclusions", 1330, 1830, 800, 560, PALE.sand, "Take-home message and implications."),
    ...section("References", 470, 1950, 800, 440, PALE.lilac, "Key references, funding and acknowledgements."),
    text("Footer", "Figure made with Di-Render · credits in the Licensing tab", 900, 2330, 20, 1200),
  ];
}

const templateObjects: Record<FigureTemplateId, () => ProjectObject[]> = {
  "experimental-workflow": workflowObjects,
  "comparison-panels": comparisonObjects,
  "microscopy-grid": microscopyObjects,
  "pathway-mechanism": pathwayObjects,
  "treatment-timeline": timelineObjects,
  "graphical-abstract": graphicalAbstractObjects,
  "cell-signaling": cellSignalingObjects,
  "mouse-study": mouseStudyObjects,
  "cell-culture-assay": cellCultureObjects,
  "virus-life-cycle": virusObjects,
  "immune-response": immuneObjects,
  "crispr-editing": crisprObjects,
  "clinical-trial": clinicalTrialObjects,
  "western-blot": westernBlotObjects,
  "drug-mechanism": drugMechanismObjects,
  "gene-expression": geneExpressionObjects,
  "organoid-screen": organoidObjects,
  "six-panel-figure": sixPanelObjects,
  "research-poster": posterObjects,
};

export function createTemplateProject(
  templateId: FigureTemplateId,
): OpenBioFigureProject {
  const template = FIGURE_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown figure template: ${templateId}`);
  const project = createProject("custom", {
    width: template.width,
    height: template.height,
  });
  project.metadata.title = template.title;
  project.document.preset = `template:${template.id}`;
  project.objects = templateObjects[templateId]();
  return project;
}
