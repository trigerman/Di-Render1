import { FolderClock, Puzzle, Shapes, Table2 } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { t, type Locale } from "../i18n/messages";

export type LeftTab = "assets" | "figures" | "data" | "plugins";

const tabs: readonly LeftTab[] = ["assets", "plugins", "figures", "data"];
export const leftTabId = (tab: LeftTab) => `left-tab-${tab}`;
const leftPanelId = (tab: LeftTab) => `left-panel-${tab}`;

interface LeftSidebarProps {
  locale: Locale;
  tab: LeftTab;
  /** Saved-figure count for the Figures tab; null while unknown. */
  figureCount: number | null;
  onTabChange: (tab: LeftTab) => void;
  assets: ReactNode;
  figures: ReactNode;
  data: ReactNode;
  plugins: ReactNode;
}

/** The editor's left column: Assets, Plugins, Figures and Data as WAI-ARIA tabs. All panels stay mounted. */
export function LeftSidebar({
  locale,
  tab,
  figureCount,
  onTabChange,
  assets,
  figures,
  data,
  plugins,
}: LeftSidebarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The editor's window-level arrow keys nudge the canvas selection.
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === "ArrowRight" ? 1 : tabs.length - 1;
    const next = tabs[(tabs.indexOf(tab) + step) % tabs.length] ?? "assets";
    onTabChange(next);
    document.getElementById(leftTabId(next))?.focus();
  };

  return (
    <aside className="left-sidebar" aria-label={t(locale, "library")}>
      <div
        className="inspector-tabs left-tabs"
        role="tablist"
        aria-label={t(locale, "libraryPanels")}
      >
        {tabs.map((value) => (
          <button
            key={value}
            id={leftTabId(value)}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={leftPanelId(value)}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTabChange(value)}
            onKeyDown={onKeyDown}
          >
            {value === "assets" ? <Shapes /> : value === "plugins" ? <Puzzle /> : value === 'data' ? <Table2 /> : <FolderClock />}
            {t(locale, value)}
            {value === "figures" && figureCount !== null && (
              <span>{figureCount}</span>
            )}
          </button>
        ))}
      </div>
      {tabs.map((value) => (
        <div
          key={value}
          id={leftPanelId(value)}
          className="left-tabpanel"
          role="tabpanel"
          aria-labelledby={leftTabId(value)}
          tabIndex={0}
          hidden={tab !== value}
        >
          {value === "assets" ? assets : value === "plugins" ? plugins : value === 'data' ? data : figures}
        </div>
      ))}
    </aside>
  );
}
