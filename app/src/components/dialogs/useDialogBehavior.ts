import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

export function useDialogBehavior(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
) {
  const closeRef = useRef(onClose);
  const previousRef = useRef<HTMLElement | null>(null);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (enabled) previousRef.current = document.activeElement as HTMLElement | null;
  }, [ref, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Capture before a step sets focus; restore after the editor is no longer inert.
    const previous = previousRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (ref.current?.contains(document.activeElement)) return;
      ref.current
        ?.querySelector<HTMLElement>("button, input, textarea, select")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = [
        ...ref.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']",
        ),
      ].filter(element => !element.closest("[inert]") && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [ref, enabled]);
}
