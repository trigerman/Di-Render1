import type { PluginLicense } from "../../types";

const CC = (id: string, name: string, path: string, attributionRequired = true): PluginLicense =>
  ({ id, name, url: `https://creativecommons.org/${path}`, attributionRequired });

export const LICENSES: Record<string, PluginLicense> = {
  "cc-0": CC("CC0-1.0", "CC0 1.0 Universal", "publicdomain/zero/1.0/", false),
  "cc-by-3.0": CC("CC-BY-3.0", "Creative Commons Attribution 3.0", "licenses/by/3.0/"),
  "cc-by-4.0": CC("CC-BY-4.0", "Creative Commons Attribution 4.0", "licenses/by/4.0/"),
  "cc-by-sa-3.0": CC("CC-BY-SA-3.0", "Creative Commons Attribution-ShareAlike 3.0", "licenses/by-sa/3.0/"),
  "cc-by-sa-4.0": CC("CC-BY-SA-4.0", "Creative Commons Attribution-ShareAlike 4.0", "licenses/by-sa/4.0/"),
  mit: { id: "MIT", name: "MIT License", url: "https://opensource.org/license/mit", attributionRequired: true },
  "public-domain": { id: "Public-Domain", name: "Public domain", url: null, attributionRequired: false },
};

export interface SourcePreset {
  label: string;
  provider: string;
  url?: string;
  license?: PluginLicense;
  credit: (name: string, author: string, license: PluginLicense | undefined) => string;
  hint: string;
}

/** Where downloaded icons come from. The licence is recorded on every icon and shown in the Licensing tab. */
export const SOURCE_PRESETS: Record<string, SourcePreset> = {
  bioicons: {
    label: "Bioicons (licence read from folders)",
    provider: "Bioicons",
    url: "https://bioicons.com/",
    credit: (name, author, license) => `${name}${author ? ` by ${author}` : ""}, distributed via Bioicons${license ? ` under ${license.name}` : ""}.`,
    hint: "On github.com/duerrsimon/bioicons choose Code → Download ZIP and import the .zip.",
  },
  servier: {
    label: "Servier Medical Art — CC BY 4.0",
    provider: "Servier Medical Art",
    url: "https://smart.servier.com/",
    license: LICENSES["cc-by-4.0"],
    credit: (name) => `${name} by Servier Medical Art (https://smart.servier.com/), licensed under CC BY 4.0.`,
    hint: "Download SVG/PNG images or a PowerPoint kit (pictures inside are extracted).",
  },
  nih: {
    label: "NIH BioArt — public domain",
    provider: "NIH BioArt Source",
    url: "https://bioart.niaid.nih.gov/",
    license: LICENSES["public-domain"],
    credit: (name) => `NIAID Visual & Medical Arts. ${name}. NIAID NIH BioArt Source. bioart.niaid.nih.gov.`,
    hint: "Each BioArt item downloads as SVG/PNG or a zip.",
  },
  scidraw: {
    label: "SciDraw — CC BY 4.0 (check each item)",
    provider: "SciDraw",
    url: "https://scidraw.io/",
    license: LICENSES["cc-by-4.0"],
    credit: (name) => `${name}, SciDraw (scidraw.io). Cite the item's DOI from its page.`,
    hint: "Some SciDraw items are CC0; the credit is harmless either way.",
  },
  reactome: {
    label: "Reactome Icon Library — CC BY 4.0",
    provider: "Reactome Icon Library",
    url: "https://reactome.org/icon-lib",
    license: LICENSES["cc-by-4.0"],
    credit: (name) => `${name}, Reactome Icon Library (https://reactome.org/icon-lib), CC BY 4.0.`,
    hint: "Most Reactome icons are already built in.",
  },
  biodraws: {
    label: "BioDraws — CC BY-SA 4.0",
    provider: "BioDraws",
    url: "https://biodraws.com/",
    license: LICENSES["cc-by-sa-4.0"],
    credit: (name) => `${name}, BioDraws (https://biodraws.com/), CC BY-SA 4.0.`,
    hint: "Share figure parts derived from CC BY-SA art under the same licence.",
  },
  osa: {
    label: "Open Science Art — CC0",
    provider: "Open Science Art",
    url: "https://openscienceart.com/",
    license: LICENSES["cc-0"],
    credit: (name) => `${name}, Open Science Art (openscienceart.com), CC0.`,
    hint: "",
  },
  own: {
    label: "My own artwork",
    provider: "Own artwork",
    license: { id: "LicenseRef-Own-work", name: "Own work", url: null, attributionRequired: false },
    credit: (name) => `${name} (own work).`,
    hint: "",
  },
  unknown: {
    label: "Other / unknown licence",
    provider: "Imported",
    credit: (name) => `${name} (source and licence not recorded).`,
    hint: "Di-Render flags unknown-licence art as not publication-ready.",
  },
};
