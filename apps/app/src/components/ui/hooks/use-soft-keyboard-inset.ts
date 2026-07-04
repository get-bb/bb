import { useEffect, useState } from "react";

/**
 * Height (px) the on-screen soft keyboard overlaps the layout viewport. iOS and
 * Android keep the layout viewport full-height and shrink only the visual
 * viewport, so a bottom-anchored element would sit behind the keyboard without
 * this offset. Returns 0 when no keyboard is open (or when unsupported).
 */
export function useSoftKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport =
      typeof window === "undefined" ? undefined : window.visualViewport;
    if (!viewport) {
      return;
    }
    const update = () => {
      const overlap = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(overlap > 1 ? overlap : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
