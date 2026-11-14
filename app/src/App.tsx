import { prepareProjectPlots } from './domain/plots/prepare';
import { parseBoundedJson } from './domain/security/input';
import {
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorStatus } from "./app/EditorStatus";
import { EditorToolbar } from "./app/EditorToolbar";
import { InspectorSidebar } from "./app/InspectorSidebar";
import { LeftSidebar, leftTabId, type LeftTab } from "./app/LeftSidebar";
import { ApplicationMenuBar } from "./app/ApplicationMenuBar";
import { SettingsScreen } from "./app/SettingsScreen";
import { StartScreen } from "./app/StartScreen";
import { WorkspaceCanvas } from "./app/WorkspaceCanvas";
import type { InspectorTab, PendingSvg, SaveState } from "./app/types";
import { seedProvider } from "./assets/provider";
import { NewDocumentDialog } from "./components/dialogs/NewDocumentDialog";
import {
  CommandPalette,
  type CommandAction,
} from "./components/dialogs/CommandPalette";
import { KeyboardShortcutsDialog } from "./components/dialogs/KeyboardShortcutsDialog";
import { SvgMetadataDialog } from "./components/dialogs/SvgMetadataDialog";
import { sanitizeSvg } from "./domain/assets/sanitize";
import { prepareImageFile } from "./domain/media/images";
import { preparePdfPrint, openPdfPrintDialog } from "./domain/export/printPdf";
import type { AssetMetadata } from "./domain/assets/schema";
import { DataPanel, datasetPlots } from './features/data/DataPanel';
import { ImportDataDialog } from './features/data/ImportDataDialog';
import { PlotWorkflow } from './features/plots/PlotWorkflow';
import type { DataSource, Dataset } from './domain/data/schema';
import type { PlotSpec } from './domain/plots/spec';
import type { ProjectObject } from './domain/project/schema';
import { dataText as d } from './i18n/messages';
import {
  assetLibraryChangeEvent,
  loadAssetLibraryState,
  recordRecentAsset,
  saveAssetLibraryState,
} from "./domain/assets/libraryState";
import {
  buildProjectJson,
  buildSvgExport,
  makeDownload,
  safeFileStem,
} from "./domain/export/exporters";
import {
  checkPublication,
  generateAttributions,
} from "./domain/licensing/attribution";
import { createProject } from "./domain/project/factory";
import { ProjectHistory } from "./domain/project/history";
import { readPortableProject } from "./domain/project/portable";
import { assertFileSize, InputError, INPUT_LIMITS } from "./domain/security/input";
import { parseProject, type OpenBioFigureProject } from "./domain/project/schema";
import {
  applyAppearancePreferences,
  loadPreferences,
  savePreferences,
  type AppPreferences,
} from "./domain/preferences/preferences";
import { createTemplateProject } from "./domain/templates/templates";
import {
  IndexedDbProjectStorage,
  type RecentProject,
} from "./domain/storage/projectStorage";
import type { FigureSummary } from "./domain/storage/figureLibrary";
import {
  FabricEditor,
  type LayerSnapshot,
  type SelectionSnapshot,
  type ArtworkTarget,
} from "./editor/FabricEditor";
import { ArtworkEditor } from "./features/artwork/ArtworkEditor";
import { DEFAULT_ASSET_FILTERS } from "./features/assets/filters";
import { DeleteFigureDialog } from "./features/figures/DeleteFigureDialog";
import { FiguresPanel } from "./features/figures/FiguresPanel";
import { messages, type Locale } from "./i18n/messages";
import { PluginDialog } from "./plugins/PluginDialog";
import { PluginsPanel } from "./plugins/PluginsPanel";
import { createPluginHost } from "./plugins/host";
import { usePlugins } from "./plugins/registry";
import type { DiRenderPlugin } from "./plugins/types";
import {
  dataUrlToBytes,
  isDesktopRuntime,
  openDesktopTextFile,
  saveDesktopBinaryFile,
  saveDesktopTextFile,
} from "./platform/desktopFiles";

const storage = new IndexedDbProjectStorage();
const ACTIVE_SESSION_KEY = "openbiofigure:active-editor";
const RENDER_FAILED_NOTICE = "The figure could not be rendered. The saved project has been preserved.";

// Serializes an editor snapshot and a history entry alike. ProjectHistory rebuilds a project as
// `{...body, media, dataSources}`, so shared inputs are serialized separately with fixed field
// order. Restoring history or changing selection must not look like a content edit.
const contentJson = ({ media, dataSources, ...body }: OpenBioFigureProject) =>
  JSON.stringify(body) +
  JSON.stringify(media.map((image) => [image.id, image.name, image.mimeType, image.width, image.height, image.data])) +
  JSON.stringify(dataSources.map((source) => source.id));

const AssetsPanel = lazy(async () => ({
  default: (await import("./features/assets/AssetsPanel")).AssetsPanel,
}));

type AppView = "home" | "editor" | "settings";

function rememberAssetUse(assetId: string) {
  try {
    const state = loadAssetLibraryState(window.localStorage);
    saveAssetLibraryState(
      window.localStorage,
      recordRecentAsset(state, assetId),
    );
    window.dispatchEvent(new Event(assetLibraryChangeEvent));
  } catch {
    // Asset placement must not depend on local-storage availability.
  }
}

export function App() {
  const [project, setProject] = useState(() => createProject("journal"));
  const [view, setView] = useState<AppView>("home");
  const [settingsReturnView, setSettingsReturnView] = useState<
    "home" | "editor"
  >("home");
  const [autosaveProject, setAutosaveProject] =
    useState<OpenBioFigureProject | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [figures, setFigures] = useState<FigureSummary[] | null>(null);
  const [figuresFailed, setFiguresFailed] = useState(false);
  const [figureToDelete, setFigureToDelete] = useState<FigureSummary | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("assets");
  const [preferences, setPreferences] = useState(() =>
    loadPreferences(window.localStorage),
  );
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [layers, setLayers] = useState<LayerSnapshot[]>([]);
  const [filters, setFilters] = useState(DEFAULT_ASSET_FILTERS);
  const [tab, setTab] = useState<InspectorTab>("properties");
  const [zoom, setZoom] = useState(0.72);
  const [panning, setPanning] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  const [pendingSvg, setPendingSvg] = useState<PendingSvg | null>(null);
  const [shortcutsDialog, setShortcutsDialog] = useState(false);
  const [dataDialog, setDataDialog] = useState<{ documentId: string; dataset?: Dataset; readOnly?: boolean; file?: File } | null>(null);
  const [plotDialog, setPlotDialog] = useState<{ documentId: string; target?: Extract<ProjectObject, { kind: 'plot' }>; datasetId?: string } | null>(null);
  const [artworkTarget, setArtworkTarget] = useState<ArtworkTarget | null>(null);
  const [commandPalette, setCommandPalette] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const editorProcessingRef = useRef(false);
  const [editorProcessing, setEditorProcessing] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  // Rendered mirror of `switchActive`: Home and Settings are inert and busy while it is set.
  const [switching, setSwitching] = useState(false);
  const [exportScale, setExportScale] = useState(preferences.pngExportScale);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<FabricEditor | null>(null);
  const historyRef = useRef(new ProjectHistory(project));
  const initialProjectRef = useRef(project);
  const initialPreferencesRef = useRef(preferences);
  const applyingHistory = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const pendingSave = useRef<OpenBioFigureProject | null>(null);
  // One document switch at a time (D-4); the editor whose first load has rendered; and the end of a
  // switch from Home or Settings, called once the first load of the editor created for its target
  // has settled, with whether it failed.
  const switchActive = useRef(false);
  const loadedEditor = useRef<FabricEditor | null>(null);
  const firstLoadSettled = useRef<((failed: boolean) => void) | null>(null);
  const figuresRequest = useRef(0);
  const openProjectRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const replacingImage = useRef(false);
  const panStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  const refreshRecent = useCallback(async () => {
    setRecentProjects(await storage.listRecent());
  }, []);

  // Fire-and-forget: a listing failure only sets the Figures tab's error state, so it can never
  // change the outcome of the save that triggered it. Only the latest request updates the list.
  const refreshFigures = useCallback(() => {
    const request = ++figuresRequest.current;
    void storage.listFigures().then(
      (list) => {
        if (request !== figuresRequest.current) return;
        setFigures(list.figures);
        setFiguresFailed(false);
      },
      () => {
        if (request === figuresRequest.current) setFiguresFailed(true);
      },
    );
  }, []);

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);
  // Plugins (Protein, Molecule, My library, external integrations).
  const pluginState = usePlugins();
  const [activePlugin, setActivePlugin] = useState<DiRenderPlugin | null>(null);
  const pluginHost = useMemo(() => activePlugin ? createPluginHost({
    pluginId: activePlugin.id,
    getEditor: () => editorRef.current,
    isSwitching: () => switchActive.current,
    notify: showNotice,
    onInserted: () => setTab("properties"),
  }) : null, [activePlugin, showNotice]);

  // A file open clears the notice of an earlier action first, so a visible "Project opened" always
  // refers to an open whose switch has finished.
  const clearNotice = () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  };

  const handleSnapshot = useCallback(
    (snapshot: {
      project: OpenBioFigureProject;
      selection: SelectionSnapshot | null;
      layers: LayerSnapshot[];
    }) => {
      setProject(snapshot.project);
      setSelection(snapshot.selection);
      setLayers(snapshot.layers);
      if (applyingHistory.current) return;
      if (contentJson(snapshot.project) === contentJson(historyRef.current.current)) return;
      historyRef.current.push(snapshot.project);
      pendingSave.current = snapshot.project;
      setSaveState("saving");
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        autosaveTimer.current = null;
        void storage
          .save(snapshot.project)
          .then(async () => {
            refreshFigures();
            await refreshRecent();
            if (pendingSave.current === snapshot.project) {
              pendingSave.current = null;
              setAutosaveProject(snapshot.project);
              setSaveState("saved");
            }
          })
          .catch((error: unknown) => {
            if (pendingSave.current === snapshot.project) setSaveState("error");
            if (error instanceof InputError && error.code === "storage_full") showNotice(error.message);
          });
      }, 450);
    },
    [refreshRecent, refreshFigures, showNotice],
  );

  const importImageFile = useCallback(async (file: File, point?: {x: number; y: number}, replace = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    const documentId = editor.getProject().metadata.id;
    try {
      const image = await prepareImageFile(file);
      // A preparation that completes during a switch is dropped: while the next figure is staged, the
      // editor still reports this one, but an insertion started then would land in the next figure.
      if (switchActive.current || editorRef.current !== editor || editor.getProject().metadata.id !== documentId) return;
      const inserted = replace ? await editor.replaceSelectedImage(image) : await editor.addImage(image, point);
      if (inserted) setTab("properties");
    } catch (error) {
      showNotice(error instanceof InputError ? error.message : "Image import failed. Your figure is still open.");
    }
  }, [showNotice]);

  useEffect(() => {
    let active = true;
    void storage
      .load()
      .then(async (saved) => {
        if (!active) return;
        const restored = saved ?? initialProjectRef.current;
        initialProjectRef.current = restored;
        setProject(restored);
        setAutosaveProject(saved);
        if (storage.recoveredPreviousRevision) showNotice("Recovered the previous valid saved revision. Export a backup before continuing.");
        refreshFigures();
        setRecentProjects(await storage.listRecent());
        historyRef.current = new ProjectHistory(restored);
        if (
          saved &&
          (window.sessionStorage.getItem(ACTIVE_SESSION_KEY) ||
            initialPreferencesRef.current.startup === "reopen")
        ) {
          setView("editor");
        }
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setSaveState("error");
          refreshFigures();
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [showNotice, refreshFigures]);

  useEffect(() => {
    if (!ready || view !== "editor" || !canvasRef.current || editorRef.current)
      return;
    const editor = new FabricEditor(
      canvasRef.current,
      initialProjectRef.current,
      handleSnapshot,
      error => showNotice(error instanceof InputError ? error.message : d(initialProjectRef.current.settings.locale, 'error')),
      busy => { editorProcessingRef.current = busy; setEditorProcessing(busy); },
    );
    editorRef.current = editor;
    let active = true;
    // A switch waiting for this editor's first load ends once it has settled, or once the editor is
    // gone; the switch never outlives the editor it opened. Returns whether a switch was waiting.
    const settleFirstLoad = (failed: boolean) => {
      const settled = firstLoadSettled.current;
      firstLoadSettled.current = null;
      settled?.(failed);
      return settled !== null;
    };
    // During a switch, the switch restores the shell when it ends, and reports a failed load after
    // its own steps, so no later notice of the switch replaces this one.
    void editor.ready.then(() => {
      if (!active) return;
      loadedEditor.current = editor;
      if (!switchActive.current) setEditorReady(true);
      settleFirstLoad(false);
    }).catch(() => {
      if (active) {
        loadedEditor.current = editor;
        if (!switchActive.current) setEditorReady(true);
        if (!settleFirstLoad(true)) showNotice(RENDER_FAILED_NOTICE);
      }
    });
    return () => {
      active = false;
      if (loadedEditor.current !== editor) settleFirstLoad(false);
      setEditorReady(false);
      editor.dispose();
      editorProcessingRef.current = false; setEditorProcessing(false);
      editorRef.current = null;
    };
  }, [ready, view, handleSnapshot, showNotice]);

  useEffect(() => {
    savePreferences(window.localStorage, preferences);
    applyAppearancePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    setExportScale(preferences.pngExportScale);
  }, [preferences.pngExportScale]);

  useEffect(() => {
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      if (saveState !== "saving" && saveState !== "error") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () =>
      window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [saveState]);

  // Saves pending edits until none is left: an edit that arrives while an earlier save is in
  // flight is saved by the next pass (D-4).
  const persistPending = useCallback(async () => {
    for (let next = pendingSave.current; next; next = pendingSave.current) {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      try {
        await storage.save(next);
        if (pendingSave.current === next) {
          pendingSave.current = null;
          setAutosaveProject(next);
          setSaveState("saved");
        }
        refreshFigures();
        await refreshRecent();
      } catch {
        setSaveState("error");
        throw new InputError("save_failed", "Your current edits could not be saved locally. Download a project backup before switching figures.");
      }
    }
  }, [refreshRecent, refreshFigures]);

  // Opens `next` (from Home or Settings without an editor, otherwise in the editor) and saves it.
  const showProject = useCallback(
    async (next: OpenBioFigureProject, resetHistory: boolean) => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      // A failed save leaves the opened target pending, so the next autosave or drain retries it,
      // and rejects with the notice for the switch (the storage_full text for a full disk).
      const saveTarget = async (target: OpenBioFigureProject) => {
        try {
          await storage.save(target);
        } catch (error) {
          if (!pendingSave.current) pendingSave.current = target;
          setSaveState("error");
          throw error instanceof InputError && error.code === "storage_full"
            ? error
            : new InputError("save_failed", "This figure is open but could not be saved locally. Download a project backup.");
        }
      };
      const editor = editorRef.current;
      if (!editor) {
        next = parseProject(next);
        initialProjectRef.current = next;
        setProject(next);
        setSelection(null);
        setLayers([]);
        historyRef.current = new ProjectHistory(next);
        window.sessionStorage.setItem(ACTIVE_SESSION_KEY, "true");
        // The switch lasts until the editor created for the target has finished its first load,
        // whether that load or the target's save succeeds or fails. A failed load rejects the
        // switch with the render notice, as a failed load in an open editor does.
        const firstLoad = new Promise<boolean>((resolve) => {
          firstLoadSettled.current = resolve;
        });
        setView("editor");
        let failed = false;
        try {
          setSaveState("saving");
          await saveTarget(next);
          setAutosaveProject(next);
          refreshFigures();
          await refreshRecent();
          setSaveState("saved");
        } finally {
          failed = await firstLoad;
        }
        if (failed) throw new InputError("render_failed", RENDER_FAILED_NOTICE);
        return;
      }
      applyingHistory.current = true;
      try {
        // An editor still running its first load (a figure restored at startup) finishes it first, so
        // that older load can never commit after the target; whether it failed does not matter here.
        if (loadedEditor.current !== editor) await editor.ready.catch(() => undefined);
        await editor.load(next);
        next = editor.getProject();
        setProject(next);
        setSelection(null);
        setLayers(editor.getLayers());
        if (resetHistory) historyRef.current = new ProjectHistory(next);
        else historyRef.current.replace(next);
      } finally {
        applyingHistory.current = false;
      }
      await saveTarget(next);
      setAutosaveProject(next);
      refreshFigures();
      await refreshRecent();
      setSaveState("saved");
    },
    [refreshRecent, refreshFigures],
  );

  // The switch boundary (D-4) around every change of document: the shell is inert before anything
  // is flushed, every pending edit is saved, and only then is the target decided, loaded and saved.
  // A failed flush rejects with `save_failed` before the target is touched, so the open figure stays.
  // Only one switch runs at a time: a request made during it is ignored and resolves to false.
  const switchDocument = useCallback(
    async (target: () => OpenBioFigureProject | Promise<OpenBioFigureProject>, resetHistory = true) => {
      if (switchActive.current) return false;
      switchActive.current = true;
      setSwitching(true);
      setEditorReady(false);
      try {
        await persistPending();
        let next = await target();
        // An edit that completed during the lookup is saved first, and the target is looked up again
        // against the committed content. The target is shown in the same task as the check that
        // nothing is pending: `showProject` stops accepting edits for the old figure before it awaits.
        while (pendingSave.current) {
          await persistPending();
          next = await target();
        }
        await showProject(next, resetHistory);
        return true;
      } finally {
        switchActive.current = false;
        setSwitching(false);
        // Only this switch restores the shell, once the editor showing the target has rendered; a
        // switch that created that editor has waited for its first load.
        if (editorRef.current && loadedEditor.current === editorRef.current) setEditorReady(true);
      }
    },
    [persistPending, showProject],
  );

  const activateProject = useCallback(
    (next: OpenBioFigureProject) => switchDocument(() => next),
    [switchDocument],
  );

  const replaceProject = useCallback(
    async (next: OpenBioFigureProject, resetHistory = true) => {
      if (!editorRef.current) return false;
      return switchDocument(() => next, resetHistory);
    },
    [switchDocument],
  );

  // A file opens as decided by content once pending edits are saved (D-5).
  const openProjectFile = useCallback(
    (file: OpenBioFigureProject) => switchDocument(() => storage.resolveImport(file)),
    [switchDocument],
  );

  const openOrReplaceProject = useCallback(
    async (next: OpenBioFigureProject) => {
      if (editorRef.current) return replaceProject(next);
      return activateProject(next);
    },
    [activateProject, replaceProject],
  );

  // History moves only when its switch can run.
  const undo = useCallback(async () => {
    if (switchActive.current) return;
    const previous = historyRef.current.undo();
    if (previous) {
      await replaceProject(previous, false);
      showNotice("Undo");
    }
  }, [replaceProject, showNotice]);
  const redo = useCallback(async () => {
    if (switchActive.current) return;
    const next = historyRef.current.redo();
    if (next) {
      await replaceProject(next, false);
      showNotice("Redo");
    }
  }, [replaceProject, showNotice]);

  const fitToScreen = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const next = Math.min(
      (workspace.clientWidth - 80) / project.document.width,
      (workspace.clientHeight - 80) / project.document.height,
      1.5,
    );
    setZoom(Math.max(0.1, next));
    window.requestAnimationFrame(() => {
      workspace.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    });
  }, [project.document.height, project.document.width]);

  useEffect(() => {
    // While the delete confirmation is open, its keys and pastes stay with it and never reach the editor.
    const onKeyDown = (event: KeyboardEvent) => {
      if (editorProcessingRef.current || artworkTarget || dataDialog || plotDialog || switchActive.current || figureToDelete) return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable)
        return;
      const editor = editorRef.current;
      if (!editor) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void redo();
      } else if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        editor.copy();
        showNotice("Copied");
      } else if (mod && event.key.toLowerCase() === "v") {
        // The paste event decides between a local image and the editor's
        // internal object clipboard.
        return;
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void editor.duplicate();
      } else if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) editor.ungroup();
        else editor.group();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        editor.deleteSelection();
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 1;
        editor.nudgeSelection(
          event.key === "ArrowLeft"
            ? -distance
            : event.key === "ArrowRight"
              ? distance
              : 0,
          event.key === "ArrowUp"
            ? -distance
            : event.key === "ArrowDown"
              ? distance
              : 0,
        );
      } else if (event.key === "0") {
        fitToScreen();
      } else if (event.code === "Space") setPanning(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setPanning(false);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editorProcessingRef.current || artworkTarget || dataDialog || plotDialog || switchActive.current || figureToDelete || (event.target instanceof HTMLElement &&
        (event.target.matches("input, textarea, select") || event.target.isContentEditable))) return;
      const image = [...(event.clipboardData?.files ?? [])].find(file => file.type === "image/png" || file.type === "image/jpeg");
      if (image) { event.preventDefault(); void importImageFile(image); }
      else if (editorRef.current) { event.preventDefault(); void editorRef.current.paste(); }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  }, [redo, undo, showNotice, fitToScreen, artworkTarget, importImageFile, figureToDelete, dataDialog, plotDialog]);

  useEffect(() => {
    if (!ready || view !== "editor" || !editorRef.current) return;
    const frame = window.requestAnimationFrame(fitToScreen);
    return () => window.cancelAnimationFrame(frame);
  }, [ready, view, fitToScreen]);

  const addAsset = useCallback(
    async (asset: AssetMetadata, point?: { x: number; y: number }) => {
      const editor = editorRef.current;
      if (!editor) return;
      const documentId = editor.getProject().metadata.id;
      try {
        const svg = sanitizeSvg(await seedProvider.loadSvg(asset)).svg;
        // Dropped during a switch, as in importImageFile.
        if (switchActive.current || editorRef.current !== editor || editor.getProject().metadata.id !== documentId) return;
        const { file, integrity, ...metadata } = asset;
        void file;
        void integrity;
        const inserted = await editor.addAsset(
          { ...metadata, svg, verified: true },
          point,
        );
        if (!inserted) return;
        rememberAssetUse(asset.id);
        setTab("properties");
      } catch (error) {
        showNotice(error instanceof InputError ? error.message : "This drawing could not be loaded. Please retry or refresh the app.");
      }
    },
    [showNotice],
  );

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-openbiofigure-asset");
    const canvas = document.querySelector(".canvas-container")?.getBoundingClientRect();
    const point = canvas ? {
      x: (event.clientX - canvas.left) / zoom,
      y: (event.clientY - canvas.top) / zoom,
    } : undefined;
    // A browser may include the thumbnail as a file in a library drag. Resolve
    // the catalog ID first; only its verified SVG may be inserted as artwork.
    if (event.dataTransfer.types.includes("application/x-openbiofigure-asset")) {
      const editor = editorRef.current;
      const documentId = editor?.getProject().metadata.id;
      const asset = await seedProvider.find(id);
      // The drop belongs to the figure it was made in; discard a stale lookup.
      if (!asset || !point || switchActive.current || editorRef.current !== editor || editor?.getProject().metadata.id !== documentId) return;
      await addAsset(asset, point);
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) {
      await importImageFile(file, point);
    }
  };

  const handleSvgFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      assertFileSize(file.size, INPUT_LIMITS.svgBytes);
      const result = sanitizeSvg(await file.text());
      setPendingSvg({
        fileName: file.name,
        svg: result.svg,
        changed: result.changed,
      });
    } catch (error) {
      showNotice(error instanceof InputError ? error.message : "SVG import failed");
    }
  };

  const runExport = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      showNotice(error instanceof InputError ? error.message : "Export failed. Your figure is still open; try a smaller export or save the project.");
    }
  };

  const exportProject = () => runExport(async () => {
    const filename = `${safeFileStem(project.metadata.title)}.obf.json`;
    const contents = buildProjectJson(project);
    if (
      !(await saveDesktopTextFile(contents, filename, [
        { name: "Di-Render project", extensions: ["obf.json", "json"] },
      ]))
    ) {
      makeDownload(contents, "application/json", filename);
    }
  });
  const exportSvg = () => runExport(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const filename = `${safeFileStem(project.metadata.title)}.svg`;
    const contents = buildSvgExport(editor.getSvg(), project);
    if (
      !(await saveDesktopTextFile(contents, filename, [
        { name: "Scalable Vector Graphics", extensions: ["svg"] },
      ]))
    ) {
      makeDownload(contents, "image/svg+xml", filename);
    }
    showNotice("SVG exported");
  });
  const exportPng = () => runExport(async () => {
    const dataUrl = editorRef.current?.getPng(exportScale);
    if (!dataUrl) return;
    const filename = `${safeFileStem(project.metadata.title)}@${exportScale}x.png`;
    if (
      !(await saveDesktopBinaryFile(await dataUrlToBytes(dataUrl), filename, [
        { name: "Portable Network Graphics", extensions: ["png"] },
      ]))
    ) {
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = filename;
      anchor.click();
    }
    showNotice(`PNG exported at ${exportScale}×`);
  });
  const exportPdf = () => runExport(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    await preparePdfPrint(editor.getSvg(), project);
    showNotice("Choose Save as PDF in the print dialog. The figure remains vector artwork.");
    openPdfPrintDialog();
  });
  const exportAttributions = (format: "markdown" | "text") => runExport(async () => {
    const output = generateAttributions(project);
    const markdown = format === "markdown";
    const contents = markdown ? output.markdown : output.text;
    const filename = markdown ? "ATTRIBUTIONS.md" : "Attribution.txt";
    if (
      !(await saveDesktopTextFile(contents, filename, [
        {
          name: markdown ? "Markdown" : "Plain text",
          extensions: [markdown ? "md" : "txt"],
        },
      ]))
    ) {
      makeDownload(
        contents,
        markdown ? "text/markdown" : "text/plain",
        filename,
      );
    }
  });

  const openDesktopProject = async () => {
    const file = await openDesktopTextFile([
      { name: "Di-Render project", extensions: ["obf.json", "json"] },
    ]);
    if (!file || switchActive.current) return;
    clearNotice();
    try {
      await prepareProjectPlots(parseBoundedJson(file.contents));
      if (await openProjectFile(
        readPortableProject(file.contents),
      )) showNotice("Project opened");
    } catch (error) {
      showNotice(
        error instanceof InputError ? error.message : "Project could not be opened",
      );
    }
  };

  const importDesktopSvg = async () => {
    const file = await openDesktopTextFile([
      { name: "Scalable Vector Graphics", extensions: ["svg"] },
    ]);
    if (!file) return;
    try {
      const result = sanitizeSvg(file.contents);
      setPendingSvg({
        fileName: file.fileName,
        svg: result.svg,
        changed: result.changed,
      });
    } catch (error) {
      showNotice(error instanceof InputError ? error.message : "SVG import failed");
    }
  };

  const openProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || switchActive.current) return;
    clearNotice();
    try {
      assertFileSize(file.size, INPUT_LIMITS.projectBytes);
      const contents = await file.text();
      await prepareProjectPlots(parseBoundedJson(contents));
      const next = readPortableProject(contents);
      if (await openProjectFile(next)) showNotice("Project opened");
    } catch (error) {
      showNotice(
        error instanceof InputError ? error.message : "Project could not be opened",
      );
    }
  };

  const notifySwitchFailure = (error: unknown) =>
    showNotice(error instanceof InputError ? error.message : "The figure could not be opened.");
  // A save failure during a switch (the flush, or the target's own save) keeps its own notice.
  const isSaveFailure = (error: unknown) =>
    error instanceof InputError && (error.code === "save_failed" || error.code === "storage_full");

  const openSavedFigure = (id: string) => {
    if (id === project.metadata.id) return;
    void switchDocument(() => storage.loadFigure(id)).catch(notifySwitchFailure);
  };

  const deleteSavedFigure = (figure: FigureSummary) => {
    setFigureToDelete(null);
    void storage.deleteFigure(figure.id).then(
      () => {
        refreshFigures();
        void refreshRecent().catch(() => undefined);
        // The deleted row held focus; the Figures tab is the nearest stable target.
        window.requestAnimationFrame(() => document.getElementById(leftTabId("figures"))?.focus());
      },
      (error: unknown) =>
        showNotice(error instanceof InputError && error.code === "figure_in_use"
          ? error.message
          : "The saved figure could not be deleted. Nothing was removed."),
    );
  };

  // The search is found by its data attribute, because its label is translated.
  const focusAssetSearch = () => {
    setLeftTab("assets");
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>("input[data-asset-search]")
        ?.focus(),
    );
  };

  const onPanStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panning || !workspaceRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      left: workspaceRef.current.scrollLeft,
      top: workspaceRef.current.scrollTop,
    };
  };
  const onPanMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panStart.current || !workspaceRef.current) return;
    workspaceRef.current.scrollLeft =
      panStart.current.left - (event.clientX - panStart.current.x);
    workspaceRef.current.scrollTop =
      panStart.current.top - (event.clientY - panStart.current.y);
  };

  const publication = checkPublication(project);
  const locale: Locale = project.settings.locale;
  const localized = messages[locale];

  const applyPreferences = (next: OpenBioFigureProject) => {
    next.settings.grid.size = preferences.gridSize;
    next.settings.grid.snap = preferences.snapToGrid;
    return next;
  };

  // While a switch owns the document, the file picker and the New dialog stay closed (D-4).
  const requestOpenProject = () => {
    if (switchActive.current) return;
    if (isDesktopRuntime()) void openDesktopProject();
    else openProjectRef.current?.click();
  };
  const openNewDialog = () => {
    if (!switchActive.current) setNewDialog(true);
  };

  useEffect(() => {
    const onApplicationShortcut = (event: KeyboardEvent) => {
      if (editorProcessingRef.current || artworkTarget || dataDialog || plotDialog) return;
      const target = event.target as HTMLElement;
      const mod = event.ctrlKey || event.metaKey;
      // A switch or the open delete confirmation blocks the shortcuts that open something; they still
      // claim their keys. Ctrl+S keeps exporting, and `?` is blocked by the confirmation only.
      const blocked = switchActive.current || figureToDelete !== null;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!blocked) setCommandPalette((open) => !open);
        return;
      }
      if (target.matches("input, textarea, select") || target.isContentEditable)
        return;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (!blocked) setNewDialog(true);
      } else if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (!blocked) requestOpenProject();
      } else if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void exportProject();
      } else if (event.key === "?") {
        event.preventDefault();
        if (!figureToDelete) setShortcutsDialog(true);
      }
    };
    window.addEventListener("keydown", onApplicationShortcut);
    return () => window.removeEventListener("keydown", onApplicationShortcut);
  });

  // Navigation is ignored while a switch owns the document, also when one starts during its save.
  const goHome = () => {
    if (switchActive.current) return;
    void persistPending().then(() => {
      if (switchActive.current) return;
      window.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      setView("home");
    }).catch(error => showNotice(error instanceof InputError ? error.message : "The current figure could not be saved."));
  };

  const openSettings = (returnTo: "home" | "editor") => {
    if (switchActive.current) return;
    void persistPending().then(() => {
      if (switchActive.current) return;
      setSettingsReturnView(returnTo);
      setView("settings");
    }).catch(error => showNotice(error instanceof InputError ? error.message : "The current figure could not be saved."));
  };

  const exitApp = () => {
    goHome();
  };

  const openData = (dataset?: Dataset, readOnly = false, file?: File) => {
    const editor = editorRef.current;
    if (!editor || switchActive.current) return;
    setDataDialog({ documentId: editor.getProject().metadata.id, dataset, readOnly, file });
  };
  const openPlot = (datasetId?: string) => {
    const editor = editorRef.current;
    if (!editor || switchActive.current) return;
    setPlotDialog({ documentId: editor.getProject().metadata.id, datasetId });
  };
  const openSelectedPlot = () => {
    const editor = editorRef.current;
    if (!editor || switchActive.current) return;
    const current = editor.getProject();
    const find = (objects: ProjectObject[]): Extract<ProjectObject, { kind: 'plot' }> | undefined => {
      for (const object of objects) {
        if (object.kind === 'plot' && object.id === editor.getSelection()?.id) return object;
        if (object.kind === 'group') { const found = find(object.children); if (found) return found; }
      }
    };
    const target = find(current.objects);
    if (target) setPlotDialog({ documentId: current.metadata.id, target });
  };
  const applyDataset = async (source: DataSource, dataset: Dataset, documentId: string) => {
    const editor = editorRef.current;
    if (!editor || switchActive.current || editor.getProject().metadata.id !== documentId) throw new InputError('data_stale', d(locale, 'error'));
    const current = editor.getProject(), previous = current.datasets.find(item => item.id === dataset.id);
    const remap = (objects: ProjectObject[]): ProjectObject[] => objects.map(object => {
      if (object.kind === 'group') return { ...object, children: remap(object.children) };
      if (object.kind !== 'plot' || object.plot.datasetId !== dataset.id || !previous) return object;
      const key = (value: string) => dataset.columns.find(column => column.name === previous.columns.find(column => column.key === value)?.name)?.key ?? 'c999999';
      const roles = Object.fromEntries(Object.entries(object.plot.roles).map(([role, value]) => [role, Array.isArray(value) ? value.map(key) : typeof value === 'string' ? key(value) : value]));
      return { ...object, plot: { ...object.plot, roles } };
    });
    await editor.updateData(previous ? current.datasets.map(item => item.id === dataset.id ? dataset : item) : [...current.datasets, dataset], current.dataSources.some(item => item.id === source.id) ? current.dataSources : [...current.dataSources, source], remap(current.objects));
    setLeftTab('data');
  };

  const commandActions: CommandAction[] = [
    {
      id: "command-new-figure",
      label: "New figure",
      description: "Choose a blank document or scientific template",
      group: "Document",
      keywords: ["document", "template"],
      shortcut: "Ctrl N",
      run: () => setNewDialog(true),
    },
    {
      id: "command-open-project",
      label: "Open project",
      description: "Open an Di-Render project from this device",
      group: "Document",
      keywords: ["file", "load"],
      shortcut: "Ctrl O",
      run: requestOpenProject,
    },
    ...(view === "editor"
      ? [
          {
            id: "command-add-text",
            label: "Add text",
            description: "Place an editable text label on the figure",
            group: "Create" as const,
            keywords: ["label", "caption", "type"],
            run: () => editorRef.current?.addText(),
          },
          {
            id: "command-add-arrow",
            label: "Add arrow",
            description: "Place a directional arrow on the figure",
            group: "Create" as const,
            keywords: ["connector", "direction", "flow"],
            run: () => editorRef.current?.addArrow(),
          },
          {
            id: "command-add-panel",
            label: "Add figure panel",
            description: "Insert an editable labelled publication panel",
            group: "Create" as const,
            keywords: ["layout", "scientific", "letter"],
            run: () => editorRef.current?.addScientificElement("panel"),
          },
          {
            id: "command-create-chart",
            label: d(locale, 'createPlot'),
            description: d(locale, 'dataNote'),
            group: "Create" as const,
            keywords: ["graph", "data", "bar", "line"],
            run: () => openPlot(),
          },
          { id: 'command-import-data', label: d(locale, 'importData'), description: d(locale, 'dataNote'), group: 'Create' as const, keywords: ['csv', 'tsv', 'spreadsheet'], run: () => openData() },
          { id: 'command-edit-plot', label: d(locale, 'editPlot'), description: d(locale, 'plotSettings'), group: 'Create' as const, keywords: ['statistics', 'graph'], run: () => openSelectedPlot() },
          {
            id: "command-search-assets",
            label: "Search scientific assets",
            description: "Move focus to the scientific asset panel",
            group: "View" as const,
            keywords: ["library", "cell", "icon", "bioicons"],
            run: focusAssetSearch,
          },
          {
            id: "command-open-layers",
            label: "Open layers",
            description: "Inspect and reorder figure objects",
            group: "View" as const,
            keywords: ["objects", "stack", "groups"],
            run: () => setTab("layers"),
          },
          {
            id: "command-publication-check",
            label: "Open license and credits",
            description: "See each drawing's license and any credit it requires",
            group: "View" as const,
            keywords: ["license", "provenance", "attribution", "credit"],
            run: () => setTab("licensing"),
          },
          {
            id: "command-fit",
            label: "Fit figure to screen",
            description: "Center the complete page in the workspace",
            group: "View" as const,
            keywords: ["zoom", "canvas", "page"],
            shortcut: "0",
            run: fitToScreen,
          },
          {
            id: "command-export-svg",
            label: "Export SVG",
            description: "Download an editable vector figure",
            group: "Export" as const,
            keywords: ["vector", "publication", "download"],
            run: () => void exportSvg(),
          },
          {
            id: "command-export-png",
            label: "Export PNG",
            description: `Download a ${exportScale}× raster figure`,
            group: "Export" as const,
            keywords: ["image", "raster", "download"],
            run: () => void exportPng(),
          },
        ]
      : []),
    {
      id: "command-settings",
      label: "Open Settings",
      description: "Adjust appearance, editor, files, and privacy",
      group: "Application",
      keywords: ["preferences", "theme", "grid", "offline"],
      run: () => openSettings(view === "editor" ? "editor" : "home"),
    },
  ];
  // While a switch is active or the delete confirmation is open, palette actions are ignored, also
  // in a palette left open when the switch started; otherwise they run as before.
  const paletteActions = commandActions.map((action) => ({
    ...action,
    run: () => {
      if (!switchActive.current && !figureToDelete) action.run();
    },
  }));

  const sharedFileInput = (
    <><input
      ref={openProjectRef}
      className="visually-hidden"
      type="file"
      accept=".json,.obf.json,application/json"
      onChange={(event) => void openProject(event)}
    /><input ref={imageInputRef} className="visually-hidden" type="file"
      accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        const replace = replacingImage.current;
        replacingImage.current = false;
        if (file) void importImageFile(file, undefined, replace);
      }} /></>
  );

  const sharedOverlays = (
    <>
      {newDialog && (
        <NewDocumentDialog
          initialPreset={preferences.defaultPreset}
          onClose={() => setNewDialog(false)}
          onCreateTemplate={(templateId) => {
            void openOrReplaceProject(
              applyPreferences(createTemplateProject(templateId)),
            ).then((opened) => {
              if (!opened) return;
              setNewDialog(false);
              window.requestAnimationFrame(fitToScreen);
            }).catch((error: unknown) => isSaveFailure(error)
              ? notifySwitchFailure(error)
              : showNotice("The template could not be opened; your figure is still available."));
          }}
          onCreate={(preset, width, height) => {
            const next = applyPreferences(
              createProject(preset, { width, height }),
            );
            const operation = editorRef.current
              ? replaceProject(next)
              : activateProject(next);
            void operation.then((opened) => {
              if (!opened) return;
              setNewDialog(false);
              window.requestAnimationFrame(fitToScreen);
            }).catch((error: unknown) => isSaveFailure(error)
              ? notifySwitchFailure(error)
              : showNotice("The figure could not be opened."));
          }}
        />
      )}
      {shortcutsDialog && (
        <KeyboardShortcutsDialog onClose={() => setShortcutsDialog(false)} />
      )}
      {commandPalette && (
        <CommandPalette
          actions={paletteActions}
          onClose={() => setCommandPalette(false)}
        />
      )}
      {notice && !artworkTarget && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </>
  );

  const openArtworkEditor = () => {
    try {
      const target = editorRef.current?.getArtworkTarget();
      if (target) setArtworkTarget(target);
    } catch (error) {
      showNotice(error instanceof InputError ? error.message : "This artwork could not be opened for editing.");
    }
  };

  if (!ready) {
    return (
      <main className="app-loading" aria-live="polite">
        <span className="loading-mark" aria-hidden="true" />
        <p>Opening Di-Render…</p>
      </main>
    );
  }

  // Home and Settings are inert and busy while a switch owns the document, as the editor shell is,
  // and their navigation and storage actions are ignored then (D-4).
  if (view === "home") {
    return (
      <>
        <div style={{ height: "100%" }} inert={switching} aria-busy={switching || undefined}>
          <StartScreen
            autosave={autosaveProject}
            recent={recentProjects.slice(0, preferences.recentProjectCount)}
            onNew={openNewDialog}
            onOpen={requestOpenProject}
            onContinue={() =>
              autosaveProject && void activateProject(autosaveProject).catch(notifySwitchFailure)
            }
            // A recent snapshot opens as decided by content once pending edits are saved (D-5), as a
            // file does, so it never replaces a differing saved figure with its id.
            onOpenRecent={(next) =>
              void switchDocument(() => storage.resolveImport(next)).catch(notifySwitchFailure)
            }
            onRemoveRecent={(projectId) => {
              if (switchActive.current) return;
              void storage.removeRecent(projectId).then(() => {
                refreshFigures();
                return refreshRecent();
              });
            }}
            onCreateTemplate={(templateId) =>
              void activateProject(
                applyPreferences(createTemplateProject(templateId)),
              ).catch(notifySwitchFailure)
            }
            onSettings={() => openSettings("home")}
          />
        </div>
        {sharedFileInput}
        {sharedOverlays}
      </>
    );
  }

  if (view === "settings") {
    return (
      <>
        <div style={{ height: "100%" }} inert={switching} aria-busy={switching || undefined}>
          <SettingsScreen
            initialSection={
              settingsReturnView === "editor" ? "editor" : "general"
            }
            preferences={preferences}
            recentCount={recentProjects.length}
            onBack={() => {
              if (switchActive.current) return;
              if (settingsReturnView === "editor") void activateProject(project).catch(notifySwitchFailure);
              else setView("home");
            }}
            onPreferencesChange={(updates: Partial<AppPreferences>) =>
              setPreferences((current) => ({ ...current, ...updates }))
            }
            onClearRecent={() => {
              if (switchActive.current) return;
              void storage.clearRecent().then(() => {
                refreshFigures();
                return refreshRecent();
              });
            }}
          />
        </div>
        {sharedFileInput}
        {sharedOverlays}
      </>
    );
  }

  return (
    <>
    <div className="app-shell" inert={!editorReady || editorProcessing || Boolean(artworkTarget || dataDialog || plotDialog)} aria-busy={!editorReady || editorProcessing}>
      <ApplicationMenuBar
        getEditor={() => editorRef.current}
        selection={selection}
        canUndo={historyRef.current.canUndo}
        canRedo={historyRef.current.canRedo}
        gridEnabled={project.settings.grid.enabled}
        title={project.metadata.title}
        onTitleChange={(title) => {
          editorRef.current?.setTitle(title);
        }}
        onHome={goHome}
        onNew={openNewDialog}
        onOpen={requestOpenProject}
        onSave={() => void exportProject()}
        onExportSvg={() => void exportSvg()}
        onExportPng={() => void exportPng()}
        onExportPdf={() => void exportPdf()}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onFit={fitToScreen}
        onZoomIn={() => setZoom((current) => Math.min(3, current + 0.1))}
        onZoomOut={() => setZoom((current) => Math.max(0.1, current - 0.1))}
        onToggleGrid={() => {
          const next = structuredClone(project);
          next.settings.grid.enabled = !next.settings.grid.enabled;
          void replaceProject(next, false);
        }}
        onOpenAssets={focusAssetSearch}
        onOpenLayers={() => setTab("layers")}
        onOpenLicensing={() => setTab("licensing")}
        onQuickActions={() => setCommandPalette(true)}
        onShortcuts={() => setShortcutsDialog(true)}
        onSettings={() => openSettings("editor")}
        onExit={exitApp}
      />
      <EditorToolbar
        getEditor={() => editorRef.current}
        selection={selection}
        canUndo={historyRef.current.canUndo}
        canRedo={historyRef.current.canRedo}
        panning={panning}
        exportScale={exportScale}
        onNew={openNewDialog}
        onRequestOpenProject={requestOpenProject}
        onSaveProject={() => void exportProject()}
        onRequestImage={() => { replacingImage.current = false; imageInputRef.current?.click(); }}
        onInsertPlot={() => openPlot()}
        insertPlotLabel={d(locale, 'createPlot')}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onPanningChange={setPanning}
        onExportScaleChange={(pngExportScale) => {
          if (![1, 2, 3, 4].includes(pngExportScale)) return;
          setPreferences((current) => ({
            ...current,
            pngExportScale: pngExportScale as AppPreferences["pngExportScale"],
          }));
        }}
        onExportSvg={() => void exportSvg()}
        onExportPng={() => void exportPng()}
        onExportPdf={() => void exportPdf()}
      />

      <div className="editor-grid" onDoubleClick={event => { if (event.target instanceof HTMLCanvasElement) { if (selection?.kind === 'plot') openSelectedPlot(); else openArtworkEditor(); } }}>
        <LeftSidebar
          locale={locale}
          tab={leftTab}
          figureCount={figuresFailed ? null : (figures?.length ?? null)}
          onTabChange={setLeftTab}
          assets={
            <Suspense
              fallback={
                <div className="left-panel panel-loading" aria-busy="true">
                  <h2>{localized.assets}</h2>
                  <p>Opening scientific asset tools…</p>
                </div>
              }
            >
              <AssetsPanel
                locale={locale}
                filters={filters}
                setFilters={setFilters}
                onAdd={addAsset}
                onInsertScientific={(kind) =>
                  editorRef.current?.addScientificElement(kind)
                }
                onCreateChart={() => openPlot()}
                onFile={(event) => void handleSvgFile(event)}
                onRequestFile={
                  isDesktopRuntime() ? () => void importDesktopSvg() : undefined
                }
                onRevealSearch={() => {
                  if (!switchActive.current && !figureToDelete) focusAssetSearch();
                }}
              />
            </Suspense>
          }
          figures={
            <FiguresPanel
              locale={locale}
              figures={figures}
              failed={figuresFailed}
              currentId={project.metadata.id}
              onOpen={openSavedFigure}
              onDelete={setFigureToDelete}
            />
          }
          plugins={<PluginsPanel state={pluginState} onOpen={setActivePlugin} />}
          data={<DataPanel project={project} locale={locale} onImport={() => openData()} onPlot={openPlot} onOpen={dataset => openData(dataset, true)} onReplace={dataset => openData(dataset)} onRename={(dataset, name) => { const editor = editorRef.current; if (editor && !switchActive.current) { const current = editor.getProject(); void editor.updateData(current.datasets.map(item => item.id === dataset.id ? { ...item, name } : item), current.dataSources).catch(error => showNotice(error instanceof Error ? error.message : d(locale, 'error'))); } }} onDelete={dataset => { const editor = editorRef.current; if (editor && !switchActive.current) { const current = editor.getProject(); if (datasetPlots(current.objects, dataset.id).length) return; void editor.updateData(current.datasets.filter(item => item.id !== dataset.id), current.dataSources).catch(error => showNotice(error instanceof Error ? error.message : d(locale, 'error'))); } }} onDrop={file => openData(undefined, false, file)} onError={showNotice} />}
        />
        <WorkspaceCanvas
          project={project}
          zoom={zoom}
          panning={panning}
          canvasRef={canvasRef}
          workspaceRef={workspaceRef}
          onDrop={(event) => void handleDrop(event)}
          onPanStart={onPanStart}
          onPanMove={onPanMove}
          onPanEnd={() => {
            panStart.current = null;
          }}
          onBackgroundChange={(color) =>
            editorRef.current?.setBackground(color)
          }
          onZoomChange={setZoom}
          onFitToScreen={fitToScreen}
        />
        <InspectorSidebar
          tab={tab}
          project={project}
          selection={selection}
          layers={layers}
          publication={publication}
          styleLabel={localized.style}
          layersLabel={localized.layers}
          getEditor={() => editorRef.current}
          onTabChange={setTab}
          onExportAttributions={(format) => void exportAttributions(format)}
          onEditArtwork={openArtworkEditor}
          onReplaceImage={() => { replacingImage.current = true; imageInputRef.current?.click(); }}
          onEditPlot={openSelectedPlot}
          onUpdatePlot={(plot) => { if (selection?.id) void editorRef.current?.applyPlot(plot, selection.id).catch(error => showNotice(error instanceof Error ? error.message : d(locale, 'error'))); }}
          locale={locale}
        />
      </div>

      <EditorStatus
        saveState={saveState}
        selection={selection}
        publication={publication}
        labels={localized}
        onOpenLicensing={() => setTab("licensing")}
        onHome={goHome}
      />
      {sharedFileInput}
      {pendingSvg && (
        <SvgMetadataDialog
          pending={pendingSvg}
          onClose={() => setPendingSvg(null)}
          onImport={(asset) => {
            void editorRef.current?.addAsset(asset).then((inserted) => {
              if (!inserted) return;
              setPendingSvg(null);
              setTab("properties");
            }).catch((error: unknown) => {
              showNotice(error instanceof InputError ? error.message : "SVG import failed. Your figure is still open.");
            });
          }}
        />
      )}
      {figureToDelete && (
        <DeleteFigureDialog
          locale={locale}
          title={figureToDelete.title}
          onCancel={() => setFigureToDelete(null)}
          onConfirm={() => deleteSavedFigure(figureToDelete)}
        />
      )}
      {sharedOverlays}
    </div>
    {activePlugin && pluginHost && <PluginDialog plugin={activePlugin} host={pluginHost} onClose={() => setActivePlugin(null)} />}
    {artworkTarget && <ArtworkEditor target={artworkTarget} onClose={() => setArtworkTarget(null)} onApply={async svg => {
      const editor = editorRef.current;
      if (!editor) throw new InputError("artwork_closed", "Reopen the figure before applying artwork changes.");
      await editor.applyArtworkEdit(artworkTarget, svg);
      showNotice("Artwork updated. You can undo this change in the figure.");
    }} />}
    {dataDialog && <ImportDataDialog locale={locale} existing={dataDialog.dataset} source={project.dataSources.find(source => source.id === dataDialog.dataset?.sourceId)} readOnly={dataDialog.readOnly} initialFile={dataDialog.file} onClose={() => setDataDialog(null)} onApply={async (source, dataset) => {
      await applyDataset(source, dataset, dataDialog.documentId);
    }} />}
    {plotDialog && <PlotWorkflow project={project} locale={locale} target={plotDialog.target} datasetId={plotDialog.datasetId} onClose={() => setPlotDialog(null)} onApply={async (plot: PlotSpec, data) => {
      const editor = editorRef.current;
      if (!editor || switchActive.current || editor.getProject().metadata.id !== plotDialog.documentId) throw new InputError('plot_stale', d(locale, 'error'));
      await editor.applyPlot(plot, plotDialog.target?.id, data); setTab('properties');
    }} />}
    </>
  );
}
