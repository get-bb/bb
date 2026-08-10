import { useEffect, type RefObject } from "react";

type AppShellElement = HTMLDivElement;
type BrowserPlatform = Pick<
  Navigator,
  "maxTouchPoints" | "platform" | "userAgent"
>;

export function shouldUseIOSVisualViewportFallback({
  maxTouchPoints,
  platform,
  userAgent,
}: BrowserPlatform): boolean {
  const isAppleWebKit = /\bAppleWebKit\//u.test(userAgent);
  const isIOSDevice =
    /\b(?:iPad|iPhone|iPod)\b/u.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
  return isAppleWebKit && isIOSDevice;
}

function getVisualViewportBottom(visualViewport: VisualViewport) {
  return Math.round(visualViewport.offsetTop + visualViewport.height);
}

function getVisualViewportPageTop(visualViewport: VisualViewport) {
  return Math.round(window.scrollY + visualViewport.offsetTop);
}

/**
 * iOS keeps the layout viewport at its original height when the software
 * keyboard opens, even though the visible viewport becomes shorter. Keep the
 * app shell's bottom aligned with the visible viewport so sticky composers do
 * not end up behind the keyboard. iOS can pan the visual viewport while the
 * keyboard opens, so both its height and its layout-relative offset matter.
 *
 * Safari also reveals a newly focused editor by panning the page. Compensate
 * for that pan directly when the page is not pinch-zoomed. `scrollTo()` does
 * not always reset a visual-viewport-only pan in an iOS standalone PWA. The
 * shell must move to the visual viewport's page-relative top and use its
 * visible height. Pinch-zoom pans (scale > 1) are intentional and must survive.
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
      if (visualViewport.scale === 1) {
        if (visualViewport.offsetTop > 0 || window.scrollY > 0) {
          // Reset a regular layout-viewport scroll when possible. The `top`
          // compensation below also handles an iOS visual-viewport-only pan.
          window.scrollTo(0, 0);
        }
        shell.style.top = `${getVisualViewportPageTop(visualViewport)}px`;
        shell.style.height = `${Math.round(visualViewport.height)}px`;
        return;
      }

      shell.style.removeProperty("top");
      shell.style.height = `${getVisualViewportBottom(visualViewport)}px`;
    };
    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(updateHeight);
    };

    updateHeight();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      shell.style.removeProperty("top");
      shell.style.removeProperty("height");
    };
  }, [enabled, shellRef]);
}
