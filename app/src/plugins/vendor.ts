/**
 * Loads large optional libraries (Mol*, SmilesDrawer) only when a plugin opens.
 * `npm run build` copies them into /vendor (see scripts/vendor-sync.mjs) so a
 * GitHub Pages deployment is self-hosted; pinned CDN URLs are the fallback.
 */
export const APP_BASE: string = import.meta.env.BASE_URL ?? "/";

const scripts = new Map<string, Promise<void>>();

function injectScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = url;
    element.async = true;
    element.crossOrigin = url.startsWith("http") ? "anonymous" : "";
    element.onload = () => resolve();
    element.onerror = () => {
      element.remove();
      reject(new Error(`Could not load ${url}`));
    };
    document.head.appendChild(element);
  });
}

export function loadScript(urls: readonly string[], globalName?: string): Promise<void> {
  const key = urls.join("|");
  const existing = scripts.get(key);
  if (existing) return existing;
  const attempt = (async () => {
    if (globalName && (window as unknown as Record<string, unknown>)[globalName]) return;
    let last: unknown;
    for (const url of urls) {
      try {
        await injectScript(url);
        if (!globalName || (window as unknown as Record<string, unknown>)[globalName]) return;
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error("Library could not be loaded. Check your connection.");
  })();
  scripts.set(key, attempt);
  attempt.catch(() => scripts.delete(key));
  return attempt;
}

const sheets = new Set<string>();
export function loadStylesheet(urls: readonly string[]) {
  const key = urls.join("|");
  if (sheets.has(key)) return;
  sheets.add(key);
  const [first, ...rest] = urls;
  if (!first) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = first;
  link.onerror = () => {
    link.remove();
    sheets.delete(key);
    if (rest.length) loadStylesheet(rest);
  };
  document.head.appendChild(link);
}

/** Self-hosted path first, then CDN. Versions are pinned in app/package.json. */
export const VENDOR = {
  molstar: {
    script: [`${APP_BASE}vendor/molstar/molstar.js`, "https://cdn.jsdelivr.net/npm/molstar@5.13.1/build/viewer/molstar.js"],
    style: [`${APP_BASE}vendor/molstar/molstar.css`, "https://cdn.jsdelivr.net/npm/molstar@5.13.1/build/viewer/molstar.css"],
    global: "molstar",
  },
  smilesDrawer: {
    script: [`${APP_BASE}vendor/smiles-drawer/smiles-drawer.min.js`, "https://cdn.jsdelivr.net/npm/smiles-drawer@2.4.1/dist/smiles-drawer.min.js"],
    global: "SmilesDrawer",
  },
} as const;

/** Set automatically by the GitHub Pages workflow (VITE_REPO_URL = https://github.com/<owner>/<repo>). */
export const REPO_URL: string = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/";
export const PLUGIN_DOCS_URL = REPO_URL.endsWith("github.com/") ? REPO_URL : `${REPO_URL}/blob/main/docs/PLUGINS.md`;
