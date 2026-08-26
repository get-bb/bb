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

/**
 * The bottom padding the app shell applies. It normally follows
 * `env(safe-area-inset-bottom)`, but iOS keeps that inset at its full value
 * while the soft keyboard is open, even though the keyboard already covers
 * the home indicator. The result is a dead band between the composer and the
 * keys — measured at about 45 CSS px on an iPhone 17 Pro (plan section 11.4).
 */
export const SHELL_SAFE_AREA_BOTTOM_PROPERTY = "--bb-safe-area-bottom";

/**
 * How much shorter the visual viewport must get before a focused editor
 * counts as "the keyboard is open". Well above a URL-bar collapse, well below
 * the shortest soft keyboard.
 */
export const KEYBOARD_OPEN_MIN_SHRINK_PX = 80;

function getVisualViewportPageTop(visualViewport: VisualViewport) {
  return Math.round(window.scrollY + visualViewport.offsetTop);
}

export function isKeyboardFocusTarget(target: EventTarget | null): boolean {
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
    // The override last written to the shell, or null while none is applied.
    // Writing shell `top`/`height` and the inherited `--bb-shell-height`
    // invalidates computed style for the whole app tree, and passes run at
    // visual-viewport event cadence (keyboard animation, URL-bar collapse),
    // so a pass that recomputes unchanged geometry must not write at all.
    let appliedOverride: { top: number; height: number } | null = null;
    // Reading `document.body.clientHeight` forces a full-document layout. The
    // shell's containing block only changes when the layout viewport does, so
    // cache the read and mark it stale only on triggers that can resize the
    // layout viewport — never on visualViewport ticks, which move or resize
    // only the visual viewport.
    let shellContainingBlockHeight = 0;
    let shellContainingBlockHeightStale = true;
    // The visual-viewport height captured when an editor took focus, and
    // whether the keyboard is currently judged open. Both drive only the
    // bottom-inset override, never the height override.
    let viewportHeightBeforeKeyboard: number | null = null;
    let appliedKeyboardInset = false;
    const setKeyboardInset = (open: boolean) => {
      if (open === appliedKeyboardInset) return;
      appliedKeyboardInset = open;
      if (open) {
        shellHeightRoot.style.setProperty(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
          "0px",
        );
      } else {
        shellHeightRoot.style.removeProperty(SHELL_SAFE_AREA_BOTTOM_PROPERTY);
      }
    };
    const updateKeyboardInset = () => {
      if (
        viewportHeightBeforeKeyboard === null ||
        !isKeyboardFocusTarget(document.activeElement)
      ) {
        setKeyboardInset(false);
        return;
      }
      setKeyboardInset(
        viewportHeightBeforeKeyboard - visualViewport.height >=
          KEYBOARD_OPEN_MIN_SHRINK_PX,
      );
    };
    const clearViewportOverride = () => {
      if (appliedOverride === null) return;
      appliedOverride = null;
      shell.style.removeProperty("top");
      shell.style.removeProperty("height");
      shellHeightRoot.style.removeProperty("--bb-shell-height");
    };
    const updateHeight = () => {
      animationFrame = null;
      updateKeyboardInset();
      if (visualViewport.scale !== 1) {
        clearViewportOverride();
        return;
      }

      const visualViewportHeight = Math.round(visualViewport.height);
      if (shellContainingBlockHeightStale) {
        // `documentElement.clientHeight` is the visible viewport height for the
        // root element, even when that root's actual CSS box extends behind an
        // Android in-app browser toolbar. The body inherits the root box and
        // therefore exposes the containing-block height the app shell really
        // receives.
        shellContainingBlockHeight = document.body.clientHeight;
        shellContainingBlockHeightStale = false;
      }
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
      const shellTop = getVisualViewportPageTop(visualViewport);
      if (
        appliedOverride !== null &&
        appliedOverride.top === shellTop &&
        appliedOverride.height === visualViewportHeight
      ) {
        return;
      }
      appliedOverride = { top: shellTop, height: visualViewportHeight };
      shell.style.top = `${shellTop}px`;
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
    // For triggers where the layout viewport may have changed: window resize,
    // rotation, and an editor gaining focus — the pass that sizes the shell
    // for the arriving keyboard must start from the real containing block,
    // and these triggers are rare enough that the forced layout is fine.
    const scheduleContainingBlockUpdate = () => {
      shellContainingBlockHeightStale = true;
      scheduleUpdate();
    };
    const handleVisualViewportScroll = () => {
      // Keyboard-less visual-viewport pans (URL-bar collapse, momentum
      // settling) don't change the containing block and need no override —
      // the pan compensation exists for the keyboard focus-reveal pan. Only
      // an already-applied override still has to track pans, because embedded
      // browsers apply one without any keyboard.
      if (
        appliedOverride === null &&
        !isKeyboardFocusTarget(document.activeElement)
      ) {
        return;
      }
      scheduleUpdate();
    };

    // Safari with its bottom toolbar visible does not update the visual
    // viewport until the keyboard animation ends. Restore the normal shell
    // immediately on keyboard dismissal instead of inventing intermediate
    // geometry that can drift out of phase with the native animation.
    const handleFocusOut = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      if (isKeyboardFocusTarget(event.relatedTarget)) return;
      viewportHeightBeforeKeyboard = null;
      setKeyboardInset(false);
      // Clearing the height override on focus loss is the iOS-only behaviour
      // described above; the bottom inset resets on every platform.
      if (!restoreImmediatelyOnKeyboardDismissal) return;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      clearViewportOverride();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      // Remember the height before the keyboard animates in; the shrink from
      // this value is the only reliable signal that it opened, because iOS may
      // resize the layout viewport too and hide the difference.
      viewportHeightBeforeKeyboard ??= visualViewport.height;
      // Programmatic focus (composer autofocus) can be the only trigger for a
      // keyboard, so this must always schedule a full, freshly measured pass.
      scheduleContainingBlockUpdate();
    };

    updateHeight();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", handleVisualViewportScroll);
    window.addEventListener("resize", scheduleContainingBlockUpdate);
    window.addEventListener("orientationchange", scheduleContainingBlockUpdate);
    // The focus listeners drive the bottom-inset override on every platform,
    // so they are no longer gated on the iOS keyboard-dismissal behaviour.
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      visualViewport.removeEventListener("resize", scheduleUpdate);
      visualViewport.removeEventListener("scroll", handleVisualViewportScroll);
      window.removeEventListener("resize", scheduleContainingBlockUpdate);
      window.removeEventListener(
        "orientationchange",
        scheduleContainingBlockUpdate,
      );
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("focusin", handleFocusIn);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      setKeyboardInset(false);
      clearViewportOverride();
    };
  }, [
    enabled,
    restoreImmediatelyOnKeyboardDismissal,
    shellHeightRootRef,
    shellRef,
  ]);
}
