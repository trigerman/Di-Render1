import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAppearancePreferences, loadPreferences } from "./domain/preferences/preferences";
import "./design-system.css";
import "./styles.css";
import "./product-surfaces.css";
import "./print.css";
import "./plugins/plugins.css";
import { DI_RENDER_VERSION } from "./plugins/host";
import { exposeGlobalRegistry } from "./plugins/registry";

applyAppearancePreferences(loadPreferences(window.localStorage));
// Lets <script>-tag integrations call window.DiRender.registerPlugin(...). See docs/PLUGINS.md.
exposeGlobalRegistry(DI_RENDER_VERSION);
await Promise.all([
  document.fonts.load('400 16px "Barlow"'),
  document.fonts.load('500 16px "Barlow"'),
  document.fonts.load('600 16px "Barlow"'),
  document.fonts.load('600 16px "Barlow Semi Condensed"'),
  document.fonts.load('400 16px "IBM Plex Sans"'),
  document.fonts.load('500 16px "IBM Plex Sans"'),
  document.fonts.load('600 16px "IBM Plex Sans"'),
  document.fonts.load('500 16px "IBM Plex Mono"'),
  document.fonts.load('400 16px "STIX Two Text"', "DNA αβ"),
  document.fonts.load('600 16px "STIX Two Text"', "DNA αβ"),
]);
createRoot(document.getElementById("root")!).render(<App />);
// Offline installation awaits digest-checked manifests and a safe update lifecycle.
