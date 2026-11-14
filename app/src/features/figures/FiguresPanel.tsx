import { FolderClock, Trash2, TriangleAlert } from "lucide-react";
import type { FigureSummary } from "../../domain/storage/figureLibrary";
import { t, type Locale } from "../../i18n/messages";

interface FiguresPanelProps {
  locale: Locale;
  /** Validated summaries, newest save first; null until the first listing returns. */
  figures: readonly FigureSummary[] | null;
  failed: boolean;
  currentId: string;
  onOpen: (id: string) => void;
  onDelete: (figure: FigureSummary) => void;
}

/** The register of figures saved in this browser. Titles render as text only. */
export function FiguresPanel({
  locale,
  figures,
  failed,
  currentId,
  onOpen,
  onDelete,
}: FiguresPanelProps) {
  const savedOn = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="left-panel figures-panel">
      <div className="panel-heading">
        <h2>{t(locale, "savedFigures")}</h2>
      </div>
      <p className="figures-note">{t(locale, "savedFiguresNote")}</p>
      {failed ? (
        <div className="figures-state">
          <span className="empty-state-icon">
            <TriangleAlert aria-hidden="true" />
          </span>
          <p>{t(locale, "savedFiguresFailed")}</p>
        </div>
      ) : figures?.length === 0 ? (
        <div className="figures-state">
          <span className="empty-state-icon">
            <FolderClock aria-hidden="true" />
          </span>
          <p>{t(locale, "noSavedFigures")}</p>
        </div>
      ) : figures ? (
        <ul className="figure-list">
          {figures.map((figure) => {
            const current = figure.id === currentId;
            return (
              <li key={figure.id}>
                <button
                  type="button"
                  className="figure-row-open"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    if (!current) onOpen(figure.id);
                  }}
                >
                  <span className="figure-thumbnail" aria-hidden="true" />
                  <span className="figure-row-copy">
                    <strong>{figure.title}</strong>
                    <small>{`${figure.width} × ${figure.height} px`}</small>
                    <time dateTime={figure.savedAt}>
                      {savedOn.format(new Date(figure.savedAt))}
                    </time>
                  </span>
                  {current && (
                    <span className="figure-open-label">
                      {t(locale, "openFigure")}
                    </span>
                  )}
                </button>
                {!current && (
                  <button
                    type="button"
                    className="figure-row-delete"
                    aria-label={`${t(locale, "deleteSavedFigure")}: ${figure.title}`}
                    title={t(locale, "deleteSavedFigure")}
                    onClick={() => onDelete(figure)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
