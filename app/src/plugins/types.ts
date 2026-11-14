import type { ComponentType } from "react";

/** Licence block attached to anything a plugin inserts. Shown in the Licensing tab. */
export interface PluginLicense {
  id: string;
  name: string;
  url?: string | null;
  attributionRequired: boolean;
}

/** Provenance for an SVG inserted by a plugin. Everything except `title` and `provider` is optional. */
export interface InsertSvgOptions {
  title: string;
  provider: string;
  description?: string;
  keywords?: string[];
  category?: string;
  creator?: string;
  creatorUrl?: string | null;
  sourceUrl?: string | null;
  license?: PluginLicense;
  attribution?: string;
}

export interface InsertImageOptions {
  /** Shown in the Layers panel. */
  name: string;
  /**
   * Where the pixels came from. It is listed in the License panel and the figure
   * legend, so readers can cite the data (e.g. a PDB entry or AlphaFold model).
   */
  credit?: {
    text: string;
    license: PluginLicense;
  };
}

/**
 * The only surface a plugin may use. It is deliberately small and stable so
 * built-in and external plugins keep working when the editor internals change.
 */
export interface PluginHost {
  /** Di-Render version, e.g. "0.3.0". */
  readonly version: string;
  /** Deployment base path ("/" locally, "/di-render/" on GitHub Pages). */
  readonly baseUrl: string;
  /** Insert vector artwork. It must pass the editor's strict SVG grammar; throws a readable Error otherwise. */
  insertSvg(svg: string, options: InsertSvgOptions): Promise<boolean>;
  /** Insert a PNG or JPEG (≤ 4 MB). */
  insertImage(image: Blob, options: InsertImageOptions): Promise<boolean>;
  /** Short message in the editor's notice bar. */
  notify(message: string): void;
  /** Current figure as SVG text or a PNG blob, for upload/sharing integrations. */
  exportFigure(kind: "svg" | "png", scale?: number): Promise<Blob>;
  getFigureInfo(): { title: string; width: number; height: number; objectCount: number };
  /** Load a classic script, trying each URL in turn (self-hosted first, CDN fallback). */
  loadScript(urls: readonly string[], globalName?: string): Promise<void>;
  loadStylesheet(urls: readonly string[]): void;
  /** Per-plugin persistent settings (localStorage, namespaced by plugin id). */
  storage: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
}

export type PluginCategory = "insert" | "library" | "export" | "integration" | "tool";

interface PluginBase {
  /** Lowercase id, e.g. "molecule" or "acme-zotero". */
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  /** Shown in the plugin card. Optional homepage / docs link. */
  homepage?: string;
  /** Short licence note for the plugin itself (not the artwork it inserts). */
  credits?: string;
}

/** Built-in plugins render a React dialog body. */
export interface BuiltinPlugin extends PluginBase {
  kind: "builtin";
  Icon: ComponentType<{ size?: number }>;
  Panel: ComponentType<{ host: PluginHost; close: () => void }>;
  /** Wider dialog for viewers such as the protein renderer. */
  wide?: boolean;
}

/**
 * External plugins are plain ES modules (no React or bundler needed). They are
 * loaded from a URL the user adds in Plugins → Manage, and receive a DOM node.
 *
 *   export default {
 *     id: "hello", name: "Hello", description: "…", category: "tool",
 *     mount(container, host, close) { … return () => { cleanup } }
 *   }
 */
export interface ExternalPluginModule extends PluginBase {
  icon?: string; // emoji or short text
  mount(container: HTMLElement, host: PluginHost, close: () => void): void | (() => void);
}

export interface ExternalPlugin extends ExternalPluginModule {
  kind: "external";
  url: string;
}

export type DiRenderPlugin = BuiltinPlugin | ExternalPlugin;
