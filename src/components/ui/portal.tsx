import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Lifts an overlay out of the view that opened it and onto `<body>`.
 *
 * `position: fixed` is only fixed to the window while nothing above it has a
 * transform, a filter or a `will-change` — any of those makes the ancestor the
 * containing block instead, and the overlay is then pinned to, and sized
 * against, whatever happened to be on screen. The app's entrance animations do
 * exactly that: every screen is rendered inside `animate-extend`, so a panel
 * rendered in place gets the height of the view's content rather than the
 * height of the window.
 *
 * Portalling sidesteps the whole class of it — a child of `<body>` has no
 * such ancestor, whatever the screen it was opened from is doing — and it is
 * the same move `Combobox` makes for the same reason.
 *
 * Server rendering has no `document` and no portals, so there the node is
 * returned where it stands; the markup is identical either way, which is what
 * `sheet.test.tsx` reads.
 */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

/* ------------------------------ escape layers ----------------------------- */

/**
 * Overlays stack — a confirmation over a panel, a panel over the page — and
 * Escape belongs to the one on top. Each overlay pushes its handler while it
 * is mounted, and one document listener calls only the last one pushed, so
 * dismissing "Discard changes?" never also closes the panel it was asked from.
 */
const escapeLayers: { current: () => void }[] = [];

function onEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = escapeLayers[escapeLayers.length - 1];
  if (!top) return;
  event.preventDefault();
  top.current();
}

export function useEscapeLayer(handler: () => void) {
  const layer = useRef(handler);
  layer.current = handler;

  useEffect(() => {
    const entry = layer;
    if (escapeLayers.length === 0) document.addEventListener("keydown", onEscape);
    escapeLayers.push(entry);
    return () => {
      const index = escapeLayers.lastIndexOf(entry);
      if (index >= 0) escapeLayers.splice(index, 1);
      if (escapeLayers.length === 0) document.removeEventListener("keydown", onEscape);
    };
  }, []);
}
