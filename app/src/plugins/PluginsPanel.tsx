import { ExternalLink, Plus, Puzzle, Settings2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { PluginState } from "./registry";
import type { DiRenderPlugin } from "./types";
import { PLUGIN_DOCS_URL } from "./vendor";

const CATEGORY_LABEL: Record<string, string> = {
  insert: "Insert",
  library: "Library",
  export: "Export",
  integration: "Integrations",
  tool: "Tools",
};

function PluginGlyph({ plugin }: { plugin: DiRenderPlugin }) {
  if (plugin.kind === "builtin") return <plugin.Icon size={18} />;
  return <span className="plugin-emoji" aria-hidden="true">{plugin.icon?.slice(0, 2) || <Puzzle size={18} />}</span>;
}

export function PluginsPanel({ state, onOpen }: { state: PluginState; onOpen: (plugin: DiRenderPlugin) => void }) {
  const [managing, setManaging] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = state.plugins.filter((p) => state.enabled(p.id));
  const groups = [...new Set(active.map((p) => p.category))];

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      await state.addExternal(url);
      setUrl("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the plugin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plugins-panel">
      <div className="plugins-head">
        <p className="plugins-intro">Generate artwork, import icon packs and connect other tools.</p>
        <button type="button" className={`button quiet${managing ? " is-active" : ""}`} onClick={() => setManaging((v) => !v)} aria-expanded={managing}>
          <Settings2 /> Manage
        </button>
      </div>

      {managing && (
        <section className="plugins-manage" aria-label="Manage plugins">
          <h3>Installed</h3>
          <ul>
            {state.plugins.map((plugin) => (
              <li key={plugin.id}>
                <label>
                  <input type="checkbox" checked={state.enabled(plugin.id)} onChange={(e) => state.setEnabled(plugin.id, e.currentTarget.checked)} />
                  <span>{plugin.name}</span>
                  <small>{plugin.kind === "builtin" ? "built-in" : "external"}</small>
                </label>
                {plugin.kind === "external" && plugin.url !== "runtime" && (
                  <button type="button" className="icon-button" aria-label={`Remove ${plugin.name}`} title="Remove" onClick={() => state.removeExternal(plugin.url)}>
                    <Trash2 />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3>Add an external plugin</h3>
          <form onSubmit={add} className="plugins-add">
            <input type="url" placeholder="https://example.org/my-plugin.js" value={url} onChange={(e) => setUrl(e.currentTarget.value)} aria-label="Plugin URL" />
            <button type="submit" className="button" disabled={busy || !url.trim()}><Plus /> Add</button>
          </form>
          <p className="plugins-warning">Only add plugins you trust: a plugin runs with the same access as this page. See <a href={PLUGIN_DOCS_URL} target="_blank" rel="noreferrer">docs/PLUGINS.md</a> for the API.</p>
          {error && <p className="notice warning" role="alert">{error}</p>}
          {Object.entries(state.errors).map(([failed, message]) => (
            <p key={failed} className="notice warning">{failed}: {message} <button type="button" className="button quiet" onClick={() => state.removeExternal(failed)}>Remove</button></p>
          ))}
        </section>
      )}

      {groups.map((group) => (
        <section key={group} className="plugins-group">
          <h3>{CATEGORY_LABEL[group] ?? group}</h3>
          {active.filter((p) => p.category === group).map((plugin) => (
            <button key={plugin.id} type="button" className="plugin-card" onClick={() => onOpen(plugin)}>
              <span className="plugin-icon"><PluginGlyph plugin={plugin} /></span>
              <span className="plugin-text">
                <strong>{plugin.name}</strong>
                <span>{plugin.description}</span>
              </span>
            </button>
          ))}
        </section>
      ))}
      {!active.length && <p className="plugins-empty">All plugins are turned off. Use Manage to turn them back on.</p>}
      <p className="plugins-footer">
        <a href={PLUGIN_DOCS_URL} target="_blank" rel="noreferrer" className="plugins-docs-link"><ExternalLink size={14} /> Write your own plugin</a>
      </p>
    </div>
  );
}
