import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useDialogBehavior } from "../components/dialogs/useDialogBehavior";
import { IconButton } from "../components/ui/IconButton";
import type { DiRenderPlugin, PluginHost } from "./types";

function ExternalMount({ plugin, host, close }: { plugin: Extract<DiRenderPlugin, { kind: "external" }>; host: PluginHost; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cleanup: void | (() => void);
    try {
      cleanup = plugin.mount(node, host, close);
    } catch (error) {
      node.textContent = `This plugin failed to start: ${error instanceof Error ? error.message : String(error)}`;
    }
    return () => {
      try { if (typeof cleanup === "function") cleanup(); } catch { /* ignore */ }
      node.replaceChildren();
    };
  }, [plugin, host, close]);
  return <div ref={ref} className="plugin-external-root" />;
}

export function PluginDialog({ plugin, host, onClose }: { plugin: DiRenderPlugin; host: PluginHost; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(ref, onClose);
  const wide = plugin.kind === "builtin" && plugin.wide;
  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={ref} className={`dialog plugin-dialog${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="plugin-dialog-title">
        <div className="dialog-header">
          <div>
            <h2 id="plugin-dialog-title">{plugin.name}</h2>
            <p className="dialog-copy">{plugin.description}</p>
          </div>
          <IconButton label="Close dialog" onClick={onClose}><X /></IconButton>
        </div>
        <div className="plugin-dialog-body">
          {plugin.kind === "builtin" ? <plugin.Panel host={host} close={onClose} /> : <ExternalMount plugin={plugin} host={host} close={onClose} />}
        </div>
        {plugin.credits && <p className="plugin-credits">{plugin.credits}</p>}
      </div>
    </div>
  );
}
