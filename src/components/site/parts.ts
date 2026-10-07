import { useEffect } from "react";

/**
 * What the public website and its booking calendar share. Both are drawn
 * under `.site` (styles/globals.css), in the contractor's brand rather than
 * the app's — the calendar on its own at /book included.
 */

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap";

/** The brand's faces, linked once and only when the site is shown. */
export function useSiteFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.append(link);
  }, []);
}

export const solidButton =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90";

export const fieldClass =
  "h-12 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40";
