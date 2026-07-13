import { useEffect, type RefObject } from "react";

type AppShellElement = HTMLDivElement;

function getVisualViewportBottom(visualViewport: VisualViewport) {
  return Math.round(visualViewport.offsetTop + visualViewport.height);
}

function isKeyboardFocusTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

/**
 * iOS keeps the layout viewport at its original height when the software
 * keyboard opens, even though the visible viewport becomes shorter. Keep the
 * app shell's bottom aligned with the visible viewport so sticky composers do
 * not end up behind the keyboard. iOS can pan the visual viewport while the
 * keyboard opens, so both its height and its layout-relative offset matter.
 *
 * Safari also reveals a newly focused editor by panning the page, computed
 * against the shell's pre-shrink geometry. Once the shell fits the visible
 * viewport that pan is obsolete — it pins the composer to the top of the
 * screen mid-animation and leaves the header hidden after the keyboard
 * settles — so undo it whenever the page is not pinch-zoomed. Pinch-zoom
 * pans (scale > 1) are intentional and must survive.
 */
export function useMobileVisualViewportHeight(
  shellRef: RefObject<AppShellElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const shell = shellRef.current;
    const visualViewport = window.visualViewport;
    if (!shell || !enabled || !visualViewport) return;

    let animationFrame: number | null = null;
    const updateHeight = () => {
      animationFrame = null;
      if (
        visualViewport.scale === 1 &&
        (visualViewport.offsetTop > 0 || window.scrollY > 0)
      ) {
        window.scrollTo(0, 0);
      }
      shell.style.height = `${getVisualViewportBottom(visualViewport)}px`;
    };
    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(updateHeight);
    };

    // iOS delivers the keyboard-hide resize event only after the hide
    // animation settles, ~half a second after blur, which strands the
    // shrunken shell (and the composer) mid-screen. Focus leaving every
    // keyboard-driving element means the keyboard is about to close, so
    // restore the stylesheet height immediately and let the eventual resize
    // event reconcile.
    const handleFocusOut = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      if (isKeyboardFocusTarget(event.relatedTarget)) return;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      shell.style.removeProperty("height");
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      scheduleUpdate();
    };

    updateHeight();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("focusin", handleFocusIn);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      shell.style.removeProperty("height");
    };
  }, [enabled, shellRef]);
}
