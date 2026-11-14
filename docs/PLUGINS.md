# Di-Render plugins and integrations

Plugins add tools to the **Plugins** tab in the left sidebar. There are three kinds:

| Kind | Where it lives | Use it for |
|---|---|---|
| **Built-in** | `app/src/plugins/builtin/<name>/`, written in React | Features that ship with Di-Render (Protein, Molecule, My library) |
| **External (URL)** | Any HTTPS URL that serves an ES module | Your own tools, lab-specific integrations, experiments |
| **Runtime** | `window.DiRender.registerPlugin(...)` from a `<script>` tag | Embedding Di-Render in another site |

Every kind talks to the editor only through the small **`PluginHost`** API below. Inserted artwork always passes through the editor's own validation, so a plugin can't add unsafe SVG or skip licence tracking.

## The host API

```ts
interface PluginHost {
  version: string;                 // "0.2.0"
  baseUrl: string;                 // "/" or "/<repo>/" on GitHub Pages

  insertSvg(svg: string, options: {
    title: string;
    provider: string;              // shown as the source in the Licensing tab
    description?: string; keywords?: string[]; category?: string;
    creator?: string; creatorUrl?: string | null; sourceUrl?: string | null;   // URLs must be https
    license?: { id: string; name: string; url?: string | null; attributionRequired: boolean };
    attribution?: string;          // the credit line users copy into their legend
  }): Promise<boolean>;            // throws a readable Error if the SVG uses unsupported features

  insertImage(image: Blob, options: { name: string }): Promise<boolean>;   // PNG or JPEG, ≤ 4 MB
  notify(message: string): void;

  exportFigure(kind: "svg" | "png", scale?: number): Promise<Blob>;       // for upload/share integrations
  getFigureInfo(): { title: string; width: number; height: number; objectCount: number };

  loadScript(urls: string[], globalName?: string): Promise<void>;          // tries each URL in turn
  loadStylesheet(urls: string[]): void;
  storage: { get<T>(key: string): T | undefined; set(key: string, value: unknown): void };  // per-plugin
}
```

### Which SVG is accepted?

The editor accepts a strict, static subset of SVG: shapes, paths, text, gradients and simple class styles. It **rejects** scripts, external references, `<image>`, `<mask>`, `<use>`, filters and animation. If `insertSvg` throws, render the SVG to PNG and call `insertImage` instead. The Molecule plugin does exactly this as its fallback.

## Writing an external plugin

An external plugin is one JavaScript file with a default export. It doesn't need React or a bundler.

```js
// my-plugin.js — host this file on any HTTPS URL (a GitHub Pages site or a gist served via jsDelivr works)
export default {
  id: "lab-legend",                       // lowercase letters, digits and hyphens
  name: "Lab legend",
  description: "Adds our lab's standard figure legend.",
  category: "tool",                        // insert | library | export | integration | tool
  icon: "🧪",

  mount(container, host, close) {
    const button = document.createElement("button");
    button.className = "button primary";   // reuse Di-Render's button styles
    button.textContent = "Insert legend";
    button.onclick = async () => {
      await host.insertSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40">
           <text x="0" y="24" font-family="Arial" font-size="14">Created by the Smith Lab</text>
         </svg>`,
        { title: "Lab legend", provider: "Lab legend plugin",
          license: { id: "CC0-1.0", name: "CC0 1.0", attributionRequired: false } });
      close();
    };
    container.append(button);
    return () => button.remove();          // optional cleanup
  },
};
```

To install it, open **Plugins → Manage → Add an external plugin**, paste the URL and click **Add**. The URL is remembered in this browser, and you can switch the plugin off or remove it in the same panel.

> ⚠️ A plugin runs with the same access as the page. Only add plugins from people you trust.

Two working examples are in [`examples/plugins/`](../examples/plugins):
- `hello-plugin.js`: inserts a labelled shape.
- `share-figure-plugin.js`: exports the current figure and copies it to the clipboard or downloads it. Use it as a template for upload integrations (Zenodo, OSF, institutional drives).

## Registering at runtime

If you embed Di-Render in another page, register a plugin after the app loads:

```html
<script type="module">
  window.DiRender.registerPlugin({ id: "embedded", name: "…", description: "…", category: "integration",
                                   mount(container, host, close) { /* … */ } });
</script>
```

## Adding a built-in plugin

1. Create `app/src/plugins/builtin/<name>/<Name>Plugin.tsx` and export a `BuiltinPlugin` object: `kind: "builtin"`, an `Icon` from `lucide-react`, and a `Panel` React component that receives `{ host, close }`.
2. Add it to the list in `app/src/plugins/builtin/index.ts`.
3. If it needs a large library, add the package to `app/package.json`, add its files to `scripts/vendor-sync.mjs`, and load it lazily with `host.loadScript([self-hosted path, pinned CDN URL])`. See `VENDOR` in `app/src/plugins/vendor.ts`. This keeps the main bundle small and the deployment self-hosted.

## Integration ideas

| Idea | How |
|---|---|
| Upload to Zenodo, OSF or Figshare | `host.exportFigure("svg")`, then the service's API with the user's token from `host.storage` |
| Zotero / reference legends | Fetch citation data, then `insertSvg` a text block |
| UniProt or PubChem lookup | Resolve a name to SMILES, then reuse the Molecule plugin's approach |
| BioRender-style templates | Insert a whole SVG composition with `insertSvg` |
| AI icon generation | Call your own endpoint, then `insertSvg` (validated) or `insertImage` |
| Lab design system | Insert approved logos, colours and legend snippets |

Requests from a plugin are made by the user's browser. The remote service must allow CORS from your Di-Render address.
