import { sanitizeSvg } from "../domain/assets/sanitize";
import type { ProjectAsset } from "../domain/assets/schema";
import { prepareImageFile, type ProjectImage } from "../domain/media/images";
import { InputError } from "../domain/security/input";
import type { FabricEditor } from "../editor/FabricEditor";
import type { InsertSvgOptions, PluginHost } from "./types";
import { APP_BASE, loadScript, loadStylesheet } from "./vendor";

export const DI_RENDER_VERSION = "0.3.0";

const https = (value?: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 2048 ? value : null;
  } catch {
    return null;
  }
};
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plugin";
const clip = (value: string, max = 9_000) => value.slice(0, max);

interface HostDeps {
  pluginId: string;
  getEditor: () => FabricEditor | null;
  isSwitching: () => boolean;
  notify: (message: string) => void;
  onInserted: () => void;
}

/** Builds the narrow API a single plugin sees. Every insert goes through the editor's own validation. */
export function createPluginHost(deps: HostDeps): PluginHost {
  const storageKey = (key: string) => `di-render:plugin:${deps.pluginId}:${key}`;
  const ready = () => {
    const editor = deps.getEditor();
    if (!editor || deps.isSwitching()) throw new InputError("editor_unavailable", "Open a figure before inserting.");
    return editor;
  };

  return {
    version: DI_RENDER_VERSION,
    baseUrl: APP_BASE,

    async insertSvg(svg: string, options: InsertSvgOptions) {
      const editor = ready();
      const documentId = editor.getProject().metadata.id;
      const safe = sanitizeSvg(svg); // throws InputError with a readable reason
      const license = options.license ?? { id: "UNKNOWN", name: "Unknown license", url: null, attributionRequired: false };
      const keywords = (options.keywords?.length ? options.keywords : [options.title]).map((k) => clip(k, 200)).slice(0, 50);
      const asset: ProjectAsset = {
        id: `plugin-${slug(deps.pluginId)}-${globalThis.crypto.randomUUID()}`,
        title: clip(options.title || "Plugin artwork", 300),
        description: clip(options.description || `${options.title} (inserted by the ${options.provider} plugin).`),
        keywords,
        category: clip(options.category || "Plugin artwork", 200),
        source: {
          provider: clip(options.provider, 200),
          sourceUrl: https(options.sourceUrl),
          assetUrl: https(options.sourceUrl),
          retrievedAt: new Date().toISOString().slice(0, 10),
        },
        creator: { name: clip(options.creator || options.provider, 300), url: https(options.creatorUrl) },
        license: {
          id: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(license.id) ? license.id : "UNKNOWN",
          name: clip(license.name || license.id, 300),
          url: https(license.url),
          attributionRequired: license.attributionRequired,
        },
        attribution: {
          text: clip(options.attribution || `${options.title}, ${options.provider}.`),
          modified: safe.changed,
          modificationNotes: safe.changed ? "SVG serialization was normalized by the Di-Render sanitizer." : null,
        },
        svg: safe.svg,
        verified: false,
      };
      if (deps.getEditor() !== editor || editor.getProject().metadata.id !== documentId || deps.isSwitching()) return false;
      const inserted = await editor.addAsset(asset);
      if (inserted) deps.onInserted();
      return inserted;
    },

    async insertImage(image: Blob, options) {
      const editor = ready();
      const documentId = editor.getProject().metadata.id;
      const type = image.type === "image/jpeg" ? "image/jpeg" : "image/png";
      const name = clip(options.name || "Plugin image", 200);
      const file = new File([image], `${slug(name)}.${type === "image/jpeg" ? "jpg" : "png"}`, { type });
      const media: ProjectImage = await prepareImageFile(file);
      if (options.credit?.text) {
        const license = options.credit.license;
        media.credit = {
          text: clip(options.credit.text, 2_000),
          licenseId: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(license.id) ? license.id : "UNKNOWN",
          licenseName: clip(license.name || license.id, 300),
          licenseUrl: https(license.url),
          attributionRequired: license.attributionRequired,
        };
      }
      if (deps.getEditor() !== editor || editor.getProject().metadata.id !== documentId || deps.isSwitching()) return false;
      const inserted = await editor.addImage({ ...media, name });
      if (inserted) deps.onInserted();
      return inserted;
    },

    notify: deps.notify,

    async exportFigure(kind, scale = 2) {
      const editor = ready();
      if (kind === "svg") return new Blob([editor.getSvg()], { type: "image/svg+xml" });
      const response = await fetch(editor.getPng(scale));
      return response.blob();
    },

    getFigureInfo() {
      const project = deps.getEditor()?.getProject();
      return {
        title: project?.metadata.title ?? "",
        width: project?.document.width ?? 0,
        height: project?.document.height ?? 0,
        objectCount: project?.objects.length ?? 0,
      };
    },

    loadScript,
    loadStylesheet,

    storage: {
      get<T>(key: string) {
        try {
          const raw = window.localStorage.getItem(storageKey(key));
          return raw === null ? undefined : (JSON.parse(raw) as T);
        } catch {
          return undefined;
        }
      },
      set(key: string, value: unknown) {
        try {
          window.localStorage.setItem(storageKey(key), JSON.stringify(value));
        } catch {
          /* storage may be disabled in private modes */
        }
      },
    },
  };
}
