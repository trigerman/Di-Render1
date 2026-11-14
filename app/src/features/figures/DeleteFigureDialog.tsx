import { Trash2 } from "lucide-react";
import { useRef } from "react";
import { useDialogBehavior } from "../../components/dialogs/useDialogBehavior";
import { t, type Locale } from "../../i18n/messages";

interface DeleteFigureDialogProps {
  locale: Locale;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirms removing a saved figure; Cancel comes first so it takes the initial focus. */
export function DeleteFigureDialog({
  locale,
  title,
  onCancel,
  onConfirm,
}: DeleteFigureDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(dialogRef, onCancel);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-figure-title"
        aria-describedby="delete-figure-description"
      >
        <div className="dialog-header">
          <h2 id="delete-figure-title">{t(locale, "deleteFigureTitle")}</h2>
        </div>
        <div id="delete-figure-description">
          <p className="confirm-subject">{title}</p>
          <p className="dialog-copy">{t(locale, "deleteFigureScope")}</p>
          <p className="dialog-copy">{t(locale, "deleteFigureFiles")}</p>
        </div>
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onCancel}>
            {t(locale, "cancel")}
          </button>
          <button
            className="button danger-outline"
            type="button"
            onClick={onConfirm}
          >
            <Trash2 aria-hidden="true" />
            {t(locale, "deleteFigure")}
          </button>
        </div>
      </section>
    </div>
  );
}
