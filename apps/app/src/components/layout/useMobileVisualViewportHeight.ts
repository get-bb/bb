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

const IOS_VIEWPORT_STABLE_MS = 300;
const IOS_VIEWPORT_MAX_SETTLE_MS = 1_500;

type ViewportGeometry = {
  layoutHeight: number;
  height: number;
  offsetTop: number;
  scrollY: number;
  scale: number;
};

function sameGeometry(a: ViewportGeometry, b: ViewportGeometry) {
  return (
    a.layoutHeight === b.layoutHeight &&
    a.height === b.height &&
    a.offsetTop === b.offsetTop &&
    a.scrollY === b.scrollY &&
    a.scale === b.scale
  );
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
  settleIOSViewport: boolean,
) {
  useEffect(() => {
    const shell = shellRef.current;
    const shellHeightRoot = shellHeightRootRef.current;
    const visualViewport = window.visualViewport;
    if (!shell || !shellHeightRoot || !enabled || !visualViewport) return;

    let animationFrame: number | null = null;
    let appliedOverride: { top: number; height: number } | null = null;
    let appliedKeyboardInset = false;
    let layoutHeight = 0;
    let layoutHeightStale = true;
    let settling: {
      deadline: number;
      stableSince: number;
      geometry: ViewportGeometry;
    } | null = null;

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
    const clearViewportOverride = () => {
      if (appliedOverride === null) return;
      appliedOverride = null;
      shell.style.removeProperty("top");
      shell.style.removeProperty("height");
      shellHeightRoot.style.removeProperty("--bb-shell-height");
    };
    const reconcile = (): ViewportGeometry => {
      if (settleIOSViewport || layoutHeightStale) {
        // The root clientHeight can reflect the clipped viewport on Android.
        // The body exposes the box the shell actually receives. Outside iOS,
        // only layout-viewport events invalidate this layout read.
        layoutHeight = document.body.clientHeight;
        layoutHeightStale = false;
      }
      const height = Math.round(visualViewport.height);
      const offsetTop = visualViewport.offsetTop;
      const scrollY = window.scrollY;
      const scale = visualViewport.scale;
      const geometry = { layoutHeight, height, offsetTop, scrollY, scale };

      const editorFocused = isKeyboardFocusTarget(document.activeElement);
      const heightMismatch = Math.abs(layoutHeight - height) > 1;
      const compensatePan =
        (offsetTop > 1 || scrollY > 0) &&
        (!settleIOSViewport ||
          editorFocused ||
          heightMismatch ||
          appliedOverride !== null);
      setKeyboardInset(
        scale === 1 &&
          editorFocused &&
          layoutHeight - height >= KEYBOARD_OPEN_MIN_SHRINK_PX,
      );
      if (scale !== 1 || (!heightMismatch && !compensatePan)) {
        clearViewportOverride();
        return geometry;
      }

      let top = Math.round(scrollY + offsetTop);
      if (compensatePan && (scrollY > 0 || appliedOverride?.top !== top)) {
        // Undo layout scrolling first. The remaining visual pan is accounted
        // for by the shell's position.
        window.scrollTo(0, 0);
        top = Math.round(window.scrollY + visualViewport.offsetTop);
      }
      // Unchanged inherited styles must not invalidate the app tree on
      // every frame of keyboard animation and viewport settling.
      if (appliedOverride?.top !== top || appliedOverride.height !== height) {
        appliedOverride = { top, height };
        shell.style.top = `${top}px`;
        shell.style.height = `${height}px`;
        shellHeightRoot.style.setProperty("--bb-shell-height", `${height}px`);
      }
      return geometry;
    };

    const reconcileFrame = () => {
      animationFrame = null;
      const geometry = reconcile();
      if (!settling) return;

      const now = performance.now();
      if (!sameGeometry(settling.geometry, geometry)) {
        settling.geometry = geometry;
        settling.stableSince = now;
      }
      // A short viewport can hold its keyboard height even after the last
      // dismissal event. Keep checking those samples until they recover or
      // the deadline expires, even if several successive readings agree.
      const stillKeyboardSized =
        geometry.scale === 1 &&
        geometry.layoutHeight - geometry.height >= KEYBOARD_OPEN_MIN_SHRINK_PX;
      if (
        now < settling.deadline &&
        (stillKeyboardSized ||
          now - settling.stableSince < IOS_VIEWPORT_STABLE_MS)
      ) {
        animationFrame = window.requestAnimationFrame(reconcileFrame);
      } else {
        settling = null;
      }
    };
    const handleViewportChange = () => {
      if (settleIOSViewport) {
        const geometry = reconcile();
        const now = performance.now();
        settling = {
          deadline: now + IOS_VIEWPORT_MAX_SETTLE_MS,
          stableSince: now,
          geometry,
        };
      }
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(reconcileFrame);
      }
    };
    const handleLayoutChange = () => {
      layoutHeightStale = true;
      handleViewportChange();
    };
    const handleViewportScroll = () => {
      if (
        settleIOSViewport ||
        appliedOverride !== null ||
        isKeyboardFocusTarget(document.activeElement)
      ) {
        handleViewportChange();
      }
    };
    const handleFocusChange = (event: FocusEvent) => {
      if (isKeyboardFocusTarget(event.target)) handleLayoutChange();
    };

    if (settleIOSViewport) {
      handleViewportChange();
      window.addEventListener("pageshow", handleLayoutChange);
      document.addEventListener("visibilitychange", handleLayoutChange);
    } else {
      reconcile();
    }
    visualViewport.addEventListener("resize", handleViewportChange);
    visualViewport.addEventListener("scroll", handleViewportScroll);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("orientationchange", handleLayoutChange);
    document.addEventListener("focusout", handleFocusChange);
    document.addEventListener("focusin", handleFocusChange);

    return () => {
      visualViewport.removeEventListener("resize", handleViewportChange);
      visualViewport.removeEventListener("scroll", handleViewportScroll);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("orientationchange", handleLayoutChange);
      window.removeEventListener("pageshow", handleLayoutChange);
      document.removeEventListener("visibilitychange", handleLayoutChange);
      document.removeEventListener("focusout", handleFocusChange);
      document.removeEventListener("focusin", handleFocusChange);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      setKeyboardInset(false);
      clearViewportOverride();
    };
  }, [enabled, settleIOSViewport, shellHeightRootRef, shellRef]);
}
