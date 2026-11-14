import type { ProjectAsset } from "../assets/schema";
import type { MediaCredit } from "../media/images";
import type { OpenBioFigureProject, ProjectObject } from "../project/schema";
import { journalSafety } from "./journal";

/** A generated image (protein render, molecule PNG) whose source must be cited. */
export interface MediaCreditEntry {
  mediaId: string;
  name: string;
  credit: MediaCredit;
}

export interface PublicationCheck {
  usedAssetCount: number;
  completeCount: number;
  incompleteCount: number;
  modifiedCount: number;
  licenseCounts: Record<string, number>;
  /** CC BY-SA drawings: their adaptations must be CC BY-SA, which CC BY journals and copyright-transfer journals generally refuse. */
  shareAlike: ProjectAsset[];
  /** NonCommercial / NoDerivatives / unknown licences. */
  restricted: ProjectAsset[];
  /** Images inserted by plugins, with their data citation. */
  mediaCredits: MediaCreditEntry[];
  /** Images the author added from their own files: Di-Render cannot know their rights. */
  ownImageCount: number;
  /** No warning, and nothing that a CC BY or subscription journal would normally refuse. */
  journalReady: boolean;
  ready: boolean;
  warnings: string[];
  notes: string[];
  assets: ProjectAsset[];
}

function collectIds(
  objects: ProjectObject[],
  ids = { assets: new Set<string>(), media: new Set<string>() },
) {
  for (const object of objects) {
    if (object.kind === "svg") ids.assets.add(object.assetId);
    if (object.kind === "image") ids.media.add(object.mediaId);
    if (object.kind === "group") collectIds(object.children, ids);
  }
  return ids;
}

export function getUsedAssets(project: OpenBioFigureProject): ProjectAsset[] {
  const { assets } = collectIds(project.objects);
  return [...assets]
    .map((id) => project.assets.find((asset) => asset.id === id))
    .filter((asset): asset is ProjectAsset => Boolean(asset));
}

function getUsedMedia(project: OpenBioFigureProject) {
  const { media } = collectIds(project.objects);
  return [...media]
    .map((id) => project.media.find((image) => image.id === id))
    .filter((image): image is NonNullable<typeof image> => Boolean(image));
}

export function hasCompleteProvenance(asset: ProjectAsset): boolean {
  return Boolean(
    asset.creator.name &&
    asset.source.provider &&
    asset.source.sourceUrl &&
    asset.license.id !== "UNKNOWN" &&
    asset.license.name &&
    asset.license.url &&
    (!asset.license.attributionRequired || asset.attribution.text),
  );
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function checkPublication(
  project: OpenBioFigureProject,
): PublicationCheck {
  const assets = getUsedAssets(project);
  const media = getUsedMedia(project);
  const incomplete = assets.filter((asset) => !hasCompleteProvenance(asset));
  const modified = assets.filter((asset) => asset.attribution.modified);
  const shareAlike = assets.filter((asset) => journalSafety(asset.license.id) === "share-alike");
  const restricted = assets.filter(
    (asset) => journalSafety(asset.license.id) === "restricted" && asset.license.id !== "UNKNOWN",
  );
  const mediaCredits = media
    .filter((image) => image.credit)
    .map((image) => ({ mediaId: image.id, name: image.name, credit: image.credit! }));
  const ownImageCount = media.length - mediaCredits.length;
  const unknownMedia = mediaCredits.filter((entry) => entry.credit.licenseId === "UNKNOWN");
  const licenseCounts: Record<string, number> = Object.create(null);
  for (const asset of assets)
    licenseCounts[asset.license.id] =
      (licenseCounts[asset.license.id] ?? 0) + 1;
  const warnings: string[] = [];
  const notes: string[] = [];
  const selfDeclared = assets.filter(asset => !asset.verified);
  if (selfDeclared.length)
    warnings.push(selfDeclared.length + " asset(s) have self-declared provenance; reviewed catalogue status has not been established.");
  if (incomplete.length)
    warnings.push(
      `${incomplete.length} asset(s) have incomplete provenance or unknown licensing.`,
    );
  if (shareAlike.length)
    warnings.push(
      `${plural(shareAlike.length, "drawing")} ${shareAlike.length === 1 ? "is" : "are"} CC BY-SA (ShareAlike). A figure that uses ${shareAlike.length === 1 ? "it" : "them"} must be released under CC BY-SA, which CC BY open-access journals (e.g. PLOS) and journals that take copyright transfer usually refuse. Replace ${shareAlike.length === 1 ? "it" : "them"} (filter the library by "Journal-safe") or get the creator's permission.`,
    );
  if (restricted.length)
    warnings.push(
      `${plural(restricted.length, "drawing")} carry NonCommercial or NoDerivatives terms; most journals cannot publish them without permission.`,
    );
  if (unknownMedia.length)
    warnings.push(
      `${plural(unknownMedia.length, "image")} came from an uploaded structure file; add its source and licence to the legend yourself.`,
    );
  if (modified.length)
    notes.push(
      `${modified.length} asset(s) were modified; the generated attribution files disclose the changes.`,
    );
  if (assets.some((asset) => asset.license.attributionRequired))
    notes.push(
      "Required attribution has been generated; keep it with the publication.",
    );
  if (mediaCredits.length)
    notes.push(
      `${plural(mediaCredits.length, "generated image")} (protein structure or molecule) ${mediaCredits.length === 1 ? "has" : "have"} a data citation in the legend.`,
    );
  if (ownImageCount)
    notes.push(
      `${plural(ownImageCount, "image")} came from your own files; make sure you hold the rights (e.g. your own micrographs).`,
    );
  const ready = incomplete.length === 0 && selfDeclared.length === 0;
  return {
    usedAssetCount: assets.length,
    completeCount: assets.length - incomplete.length,
    incompleteCount: incomplete.length,
    modifiedCount: modified.length,
    licenseCounts,
    shareAlike,
    restricted,
    mediaCredits,
    ownImageCount,
    journalReady: ready && !shareAlike.length && !restricted.length && !unknownMedia.length,
    ready,
    warnings,
    notes,
    assets,
  };
}

const uniqueCredits = (assets: ProjectAsset[]) => {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.attribution.text}|${asset.license.id}|${asset.source.sourceUrl ?? "unknown"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Collections whose licensor asks for one collection-level credit line.
 * Servier's own FAQ gives a single sentence "wherever you use the images".
 * Every other source is credited per drawing, because its licence names individual creators.
 */
const COLLECTION_CREDITS: Array<{ match: (asset: ProjectAsset) => boolean; line: (adapted: boolean) => string }> = [
  {
    match: (asset) => asset.source.provider === "Servier Medical Art" && asset.license.id === "CC-BY-4.0",
    line: (adapted) =>
      `${adapted ? "Images adapted from" : "Images provided by"} Servier Medical Art (https://smart.servier.com/), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).`,
  },
  {
    match: (asset) => asset.source.provider === "Servier Medical Art via Bioicons" && asset.license.id === "CC-BY-3.0",
    line: (adapted) =>
      `${adapted ? "Images adapted from" : "Images from"} Servier Medical Art (https://smart.servier.com/), vector edition via Bioicons, licensed under CC BY 3.0 Unported (https://creativecommons.org/licenses/by/3.0/).`,
  },
];

/** Short, ready-to-paste legend: one line per collection, then per-drawing credits, then data citations. */
export function figureLegend(check: PublicationCheck): string {
  const credits = uniqueCredits(check.assets).filter((asset) => asset.license.attributionRequired);
  const lines: string[] = [];
  const rest: ProjectAsset[] = [];
  for (const group of COLLECTION_CREDITS) {
    const members = credits.filter(group.match);
    if (members.length) lines.push(group.line(members.some((asset) => asset.attribution.modified)));
  }
  for (const asset of credits) if (!COLLECTION_CREDITS.some((group) => group.match(asset))) rest.push(asset);
  lines.push(...rest.map((asset) => asset.attribution.text));
  const seen = new Set<string>();
  for (const entry of check.mediaCredits)
    if (!seen.has(entry.credit.text)) { seen.add(entry.credit.text); lines.push(entry.credit.text); }
  return lines.join(" ");
}

export function generateAttributions(project: OpenBioFigureProject) {
  const check = checkPublication(project);
  const credits = uniqueCredits(check.assets);
  const required = credits.filter((asset) => asset.license.attributionRequired);
  const details = credits.map((asset) => {
    const modified = asset.attribution.modified
      ? ` Modified: ${asset.attribution.modificationNotes ?? "yes (details not supplied)"}.`
      : "";
    return `${asset.attribution.text} Source: ${asset.source.sourceUrl ?? "not supplied"} License: ${asset.license.url ?? "not supplied"}.${modified}`;
  });
  const dataCitations = check.mediaCredits.map(
    (entry) => `${entry.name}: ${entry.credit.text} (${entry.credit.licenseName}${entry.credit.licenseUrl ? `, ${entry.credit.licenseUrl}` : ""})`,
  );
  const legendText = figureLegend(check);
  const status = check.journalReady
    ? "Licence check: every element is public domain, CC0, CC BY or MIT — compatible with CC BY open-access and subscription journals when the credits below are included."
    : "Licence check: review the warnings below before submitting.";
  const markdown = [
    `# Attributions for ${project.metadata.title}`,
    "",
    "> Generated from project metadata. Di-Render helps track licensing metadata; it does not provide legal advice.",
    "",
    status,
    ...(check.warnings.length ? ["", "## Warnings", "", ...check.warnings.map((line) => `- ${line}`)] : []),
    "",
    "## Figure legend (paste into the caption or acknowledgments)",
    "",
    legendText || "No bundled asset in this figure requires attribution.",
    "",
    "## Required attribution",
    "",
    ...(required.length
      ? required.map((asset) => `- ${asset.attribution.text}`)
      : ["No bundled asset in this figure requires attribution."]),
    ...(dataCitations.length ? ["", "## Data citations", "", ...dataCitations.map((line) => `- ${line}`)] : []),
    "",
    "## Provenance ledger",
    "",
    ...(details.length
      ? details.map((line) => `- ${line}`)
      : ["No scientific assets are used in this figure."]),
    "",
  ].join("\n");
  const text = [
    `Attributions for ${project.metadata.title}`,
    "Di-Render tracks metadata and does not provide legal advice.",
    status,
    ...check.warnings.map((line) => `WARNING: ${line}`),
    "",
    "Figure legend:",
    legendText || "No bundled asset in this figure requires attribution.",
    "",
    ...(required.length
      ? required.map((asset) => asset.attribution.text)
      : ["No bundled asset in this figure requires attribution."]),
    ...(dataCitations.length ? ["", "Data citations:", ...dataCitations] : []),
    "",
    ...details,
  ].join("\n");
  const legend = legendText || "No attribution-required bundled assets are used in this figure.";
  return { markdown, text, legend, check };
}
