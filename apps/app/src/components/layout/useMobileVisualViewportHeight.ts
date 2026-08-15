import { useEffect, type RefObject } from "react";

type AppShellElement = HTMLDivElement;
type BrowserPlatform = Pick<
  Navigator,
  "maxTouchPoints" | "platform" | "userAgent"
>;

export function shouldRestoreIOSViewportOnKeyboardDismissal({
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

function getVisualViewportPageTop(visualViewport: VisualViewport) {
  return Math.round(window.scrollY + visualViewport.offsetTop);
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
 * Some mobile browsers keep the layout viewport at its original height when
 * the software keyboard or embedded-browser chrome reduces the visible area.
 * Apply a shell override only while the layout and visual viewport heights
 * disagree so native interactive-widget resizing remains authoritative.
 *
 * Browsers can also reveal a newly focused editor by panning the visual
 * viewport. Compensate for that pan at 1x zoom; pinch-zoom pans are intentional
 * and must survive untouched.
 */
export function useMobileVisualViewportHeight(
  shellRef: RefObject<AppShellElement | null>,
  shellHeightRootRef: RefObject<AppShellElement | null>,
  enabled: boolean,
  restoreImmediatelyOnKeyboardDismissal: boolean,
) {
  useEffect(() => {
    const shell = shellRef.current;
    const shellHeightRoot = shellHeightRootRef.current;
    const visualViewport = window.visualViewport;
    if (!shell || !shellHeightRoot || !enabled || !visualViewport) return;

    let animationFrame: number | null = null;
    const clearViewportOverride = () => {
      shell.style.removeProperty("top");
      shell.style.removeProperty("height");
      shellHeightRoot.style.removeProperty("--bb-shell-height");
    };
    const updateHeight = () => {
      animationFrame = null;
      if (visualViewport.scale !== 1) {
        clearViewportOverride();
        return;
      }

      const visualViewportHeight = Math.round(visualViewport.height);
      // `documentElement.clientHeight` is the visible viewport height for the
      // root element, even when that root's actual CSS box extends behind an
      // Android in-app browser toolbar. The body inherits the root box and
      // therefore exposes the containing-block height the app shell really
      // receives.
      const shellContainingBlockHeight = document.body.clientHeight;
      const hasVisualViewportPan =
        visualViewport.offsetTop > 1 || window.scrollY > 0;
      if (
        Math.abs(shellContainingBlockHeight - visualViewportHeight) <= 1 &&
        !hasVisualViewportPan
      ) {
        // Avoid an unnecessary JS override when native layout resizing
        // already matches the visible viewport.
        clearViewportOverride();
        return;
      }

      if (hasVisualViewportPan) {
        // Reset a regular layout-viewport scroll when possible. The `top`
        // compensation below also handles a visual-viewport-only pan.
        window.scrollTo(0, 0);
      }
      shell.style.top = `${getVisualViewportPageTop(visualViewport)}px`;
      shell.style.height = `${visualViewportHeight}px`;
      // Fixed-position descendants cannot inherit the shell element's pixel
      // height. Publish the same correction through the existing shell-height
      // switch so the mobile sidebar footer stays inside embedded browsers'
      // visual viewport too.
      shellHeightRoot.style.setProperty(
        "--bb-shell-height",
        `${visualViewportHeight}px`,
      );
    };
    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(updateHeight);
    };

    // Safari with its bottom toolbar visible does not update the visual
    // viewport until the keyboard animation ends. Restore the normal shell
    // immediately on keyboard dismissal instead of inventing intermediate
    // geometry that can drift out of phase with the native animation.
    const handleFocusOut = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      if (isKeyboardFocusTarget(event.relatedTarget)) return;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      clearViewportOverride();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      scheduleUpdate();
    };

    updateHeight();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    if (restoreImmediatelyOnKeyboardDismissal) {
      document.addEventListener("focusout", handleFocusOut);
      document.addEventListener("focusin", handleFocusIn);
    }

    return () => {
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (restoreImmediatelyOnKeyboardDismissal) {
        document.removeEventListener("focusout", handleFocusOut);
        document.removeEventListener("focusin", handleFocusIn);
      }
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      clearViewportOverride();
    };
  }, [
    enabled,
    restoreImmediatelyOnKeyboardDismissal,
    shellHeightRootRef,
    shellRef,
  ]);
}
