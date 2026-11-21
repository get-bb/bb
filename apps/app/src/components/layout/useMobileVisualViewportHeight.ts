import { useEffect } from "react";

type AppShellElement = HTMLDivElement;

export const SHELL_SAFE_AREA_BOTTOM_PROPERTY = "--bb-safe-area-bottom";

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

function attachMobileVisualViewportHeight(
  shell: AppShellElement,
  settleIOSViewport: boolean,
): (() => void) | undefined {
  const visualViewport = window.visualViewport;
  if (!visualViewport) return undefined;
  const viewportStyleRoot = shell.ownerDocument.body;

  let animationFrame: number | null = null;
  let appliedOverride: { top: number; height: number } | null = null;
  let viewportHeightBeforeKeyboard: number | null = null;
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
      viewportStyleRoot.style.setProperty(
        SHELL_SAFE_AREA_BOTTOM_PROPERTY,
        "0px",
      );
    } else {
      viewportStyleRoot.style.removeProperty(SHELL_SAFE_AREA_BOTTOM_PROPERTY);
    }
  };
  const clearViewportOverride = () => {
    if (appliedOverride === null) return;
    appliedOverride = null;
    shell.style.removeProperty("top");
    shell.style.removeProperty("height");
    viewportStyleRoot.style.removeProperty("--bb-shell-height");
  };
  const reconcile = (): ViewportGeometry => {
    if (settleIOSViewport || layoutHeightStale) {
      layoutHeight = document.body.clientHeight;
      layoutHeightStale = false;
    }
    const viewportHeight = visualViewport.height;
    const height = Math.round(viewportHeight);
    const offsetTop = visualViewport.offsetTop;
    const scrollY = window.scrollY;
    const scale = visualViewport.scale;
    const geometry = { layoutHeight, height, offsetTop, scrollY, scale };

    const editorFocused = isKeyboardFocusTarget(document.activeElement);
    const heightMismatch = Math.abs(layoutHeight - height) > 1;
    const compensatePan =
      (offsetTop > 1 || scrollY > 0) &&
      (!settleIOSViewport || editorFocused || heightMismatch);
    setKeyboardInset(
      viewportHeightBeforeKeyboard !== null &&
        editorFocused &&
        viewportHeightBeforeKeyboard - viewportHeight >=
          KEYBOARD_OPEN_MIN_SHRINK_PX,
    );
    if (scale !== 1 || (!heightMismatch && !compensatePan)) {
      clearViewportOverride();
      return geometry;
    }

    let top = Math.round(scrollY + offsetTop);
    if (compensatePan && (!settleIOSViewport || scrollY > 0)) {
      window.scrollTo(0, 0);
      top = Math.round(window.scrollY + visualViewport.offsetTop);
    }
    if (appliedOverride?.top !== top || appliedOverride.height !== height) {
      appliedOverride = { top, height };
      shell.style.top = `${top}px`;
      shell.style.height = `${height}px`;
      viewportStyleRoot.style.setProperty("--bb-shell-height", `${height}px`);
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
      !settleIOSViewport &&
      appliedOverride === null &&
      !isKeyboardFocusTarget(document.activeElement)
    ) {
      return;
    }
    handleViewportChange();
  };
  const handleFocusOut = (event: FocusEvent) => {
    if (!isKeyboardFocusTarget(event.target)) return;
    if (isKeyboardFocusTarget(event.relatedTarget)) return;
    viewportHeightBeforeKeyboard = null;
    setKeyboardInset(false);
    if (settleIOSViewport) handleLayoutChange();
  };
  const handleFocusIn = (event: FocusEvent) => {
    if (!isKeyboardFocusTarget(event.target)) return;
    viewportHeightBeforeKeyboard ??= visualViewport.height;
    handleLayoutChange();
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
  document.addEventListener("focusout", handleFocusOut);
  document.addEventListener("focusin", handleFocusIn);

  return () => {
    visualViewport.removeEventListener("resize", handleViewportChange);
    visualViewport.removeEventListener("scroll", handleViewportScroll);
    window.removeEventListener("resize", handleLayoutChange);
    window.removeEventListener("orientationchange", handleLayoutChange);
    window.removeEventListener("pageshow", handleLayoutChange);
    document.removeEventListener("visibilitychange", handleLayoutChange);
    document.removeEventListener("focusout", handleFocusOut);
    document.removeEventListener("focusin", handleFocusIn);
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    setKeyboardInset(false);
    clearViewportOverride();
  };
}

export function useMobileVisualViewportHeight(
  shell: AppShellElement | null,
  settleIOSViewport: boolean,
) {
  useEffect(() => {
    if (!shell) return;
    return attachMobileVisualViewportHeight(shell, settleIOSViewport);
  }, [shell, settleIOSViewport]);
}
