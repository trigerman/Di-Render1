import { useCallback, useEffect, useState } from "react";
import { builtinPlugins } from "./builtin";
import type { DiRenderPlugin, ExternalPlugin, ExternalPluginModule } from "./types";

const DISABLED_KEY = "di-render:plugins:disabled";
const EXTERNAL_KEY = "di-render:plugins:external";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function validModule(value: unknown): value is ExternalPluginModule {
  const m = value as Partial<ExternalPluginModule> | null;
  return !!m && typeof m.id === "string" && /^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id) &&
    typeof m.name === "string" && typeof m.description === "string" && typeof m.mount === "function";
}

/** Load one external ES-module plugin. Only HTTPS (or same-origin) URLs are accepted. */
export async function loadExternalPlugin(url: string): Promise<ExternalPlugin> {
  const resolved = new URL(url, window.location.href);
  if (resolved.protocol !== "https:" && resolved.origin !== window.location.origin)
    throw new Error("Plugin URLs must use HTTPS.");
  const module = (await import(/* @vite-ignore */ resolved.href)) as { default?: unknown };
  const candidate = module.default ?? module;
  if (!validModule(candidate)) throw new Error("This file is not a Di-Render plugin (see docs/PLUGINS.md).");
  if (builtinPlugins.some((p) => p.id === candidate.id)) throw new Error(`A built-in plugin already uses the id "${candidate.id}".`);
  return { ...candidate, category: candidate.category ?? "tool", kind: "external", url: resolved.href };
}

/** Plugins registered at runtime through window.DiRender.registerPlugin (e.g. from a <script> tag). */
const runtime = new Map<string, ExternalPlugin>();
const listeners = new Set<() => void>();

declare global {
  interface Window {
    DiRender?: { version: string; registerPlugin(plugin: ExternalPluginModule): void };
  }
}

export function exposeGlobalRegistry(version: string) {
  window.DiRender = {
    version,
    registerPlugin(plugin) {
      if (!validModule(plugin)) throw new Error("Invalid Di-Render plugin.");
      runtime.set(plugin.id, { ...plugin, kind: "external", url: "runtime" });
      listeners.forEach((fn) => fn());
    },
  };
}

export interface PluginState {
  plugins: DiRenderPlugin[];
  enabled: (id: string) => boolean;
  setEnabled: (id: string, on: boolean) => void;
  externalUrls: string[];
  addExternal: (url: string) => Promise<void>;
  removeExternal: (url: string) => void;
  errors: Record<string, string>;
}

export function usePlugins(): PluginState {
  const [disabled, setDisabled] = useState<string[]>(() => readJson(DISABLED_KEY, []));
  const [externalUrls, setExternalUrls] = useState<string[]>(() => readJson(EXTERNAL_KEY, []));
  const [external, setExternal] = useState<ExternalPlugin[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, bump] = useState(0);

  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled(externalUrls.map(loadExternalPlugin)).then((results) => {
      if (!active) return;
      const ok: ExternalPlugin[] = [];
      const bad: Record<string, string> = {};
      results.forEach((result, index) => {
        if (result.status === "fulfilled") ok.push(result.value);
        else bad[externalUrls[index]!] = result.reason instanceof Error ? result.reason.message : "Failed to load";
      });
      setExternal(ok);
      setErrors(bad);
    });
    return () => { active = false; };
  }, [externalUrls]);

  const setEnabled = useCallback((id: string, on: boolean) => {
    setDisabled((current) => {
      const next = on ? current.filter((x) => x !== id) : [...new Set([...current, id])];
      writeJson(DISABLED_KEY, next);
      return next;
    });
  }, []);

  const addExternal = useCallback(async (url: string) => {
    const plugin = await loadExternalPlugin(url.trim());
    setExternalUrls((current) => {
      const next = [...new Set([...current, plugin.url])];
      writeJson(EXTERNAL_KEY, next);
      return next;
    });
  }, []);

  const removeExternal = useCallback((url: string) => {
    setExternalUrls((current) => {
      const next = current.filter((x) => x !== url);
      writeJson(EXTERNAL_KEY, next);
      return next;
    });
  }, []);

  const seen = new Set<string>();
  const plugins = [...builtinPlugins, ...external, ...runtime.values()].filter((p) => !seen.has(p.id) && seen.add(p.id));
  return {
    plugins,
    enabled: (id) => !disabled.includes(id),
    setEnabled,
    externalUrls,
    addExternal,
    removeExternal,
    errors,
  };
}
