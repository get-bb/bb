import { useEffect } from "react";

type AppShellElement = HTMLDivElement;

export const SHELL_SAFE_AREA_BOTTOM_PROPERTY = "--bb-safe-area-bottom";

export const KEYBOARD_OPEN_MIN_SHRINK_PX = 80;

const IOS_VIEWPORT_SETTLE_MS = 400;

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

function attachMobileVisualViewportHeight(
  shell: AppShellElement,
  restoreImmediatelyOnKeyboardDismissal: boolean,
): (() => void) | undefined {
  const visualViewport = window.visualViewport;
  if (!visualViewport) return undefined;
  const viewportStyleRoot = shell.ownerDocument.body;

  let animationFrame: number | null = null;
  let appliedOverride: { top: number; height: number } | null = null;
  let shellContainingBlockHeight = 0;
  let shellContainingBlockHeightStale = true;
  let layoutViewportWidth = 0;
  let viewportHeightBeforeKeyboard: number | null = null;
  let dismissedKeyboardBaseline: number | null = null;
  let viewportRecheck: number | null = null;
  let appliedKeyboardInset = false;
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
  const updateKeyboardInset = (viewportHeight: number) => {
    if (
      viewportHeightBeforeKeyboard === null ||
      !isKeyboardFocusTarget(document.activeElement)
    ) {
      setKeyboardInset(false);
      return;
    }
    setKeyboardInset(
      viewportHeightBeforeKeyboard - viewportHeight >=
        KEYBOARD_OPEN_MIN_SHRINK_PX,
    );
  };
  const clearViewportOverride = () => {
    if (appliedOverride === null) return;
    appliedOverride = null;
    shell.style.removeProperty("top");
    shell.style.removeProperty("height");
    viewportStyleRoot.style.removeProperty("--bb-shell-height");
  };
  const updateHeight = () => {
    animationFrame = null;
    const viewportHeight = visualViewport.height;
    if (visualViewport.scale !== 1) {
      updateKeyboardInset(viewportHeight);
      clearViewportOverride();
      return;
    }

    const visualViewportHeight = Math.round(viewportHeight);
    if (shellContainingBlockHeightStale) {
      shellContainingBlockHeight = document.body.clientHeight;
      shellContainingBlockHeightStale = false;
      if (
        restoreImmediatelyOnKeyboardDismissal &&
        layoutViewportWidth !== window.innerWidth
      ) {
        layoutViewportWidth = window.innerWidth;
        if (isKeyboardFocusTarget(document.activeElement)) {
          viewportHeightBeforeKeyboard = shellContainingBlockHeight;
        }
        if (dismissedKeyboardBaseline !== null) {
          dismissedKeyboardBaseline = shellContainingBlockHeight;
        }
      }
    }
    updateKeyboardInset(viewportHeight);
    if (dismissedKeyboardBaseline !== null) {
      if (
        dismissedKeyboardBaseline - viewportHeight >=
        KEYBOARD_OPEN_MIN_SHRINK_PX
      ) {
        clearViewportOverride();
        return;
      }
      dismissedKeyboardBaseline = null;
    }
    const hasVisualViewportPan =
      visualViewport.offsetTop > 1 || window.scrollY > 0;
    if (
      Math.abs(shellContainingBlockHeight - visualViewportHeight) <= 1 &&
      !hasVisualViewportPan
    ) {
      clearViewportOverride();
      return;
    }

    if (hasVisualViewportPan) {
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
    viewportStyleRoot.style.setProperty(
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
  const scheduleContainingBlockUpdate = () => {
    shellContainingBlockHeightStale = true;
    scheduleUpdate();
  };
  const cancelViewportRecheck = () => {
    if (viewportRecheck === null) return;
    window.clearTimeout(viewportRecheck);
    viewportRecheck = null;
  };
  const scheduleViewportRecheck = () => {
    cancelViewportRecheck();
    viewportRecheck = window.setTimeout(() => {
      viewportRecheck = null;
      scheduleContainingBlockUpdate();
    }, IOS_VIEWPORT_SETTLE_MS);
  };
  const recheckDuringKeyboardResize = () => {
    if (
      restoreImmediatelyOnKeyboardDismissal &&
      (appliedKeyboardInset || dismissedKeyboardBaseline !== null)
    ) {
      scheduleViewportRecheck();
    }
  };
  const handleVisualViewportResize = () => {
    recheckDuringKeyboardResize();
    scheduleUpdate();
  };
  const handleWindowResize = () => {
    recheckDuringKeyboardResize();
    scheduleContainingBlockUpdate();
  };
  const reconcileViewport = () => {
    scheduleContainingBlockUpdate();
    if (restoreImmediatelyOnKeyboardDismissal) scheduleViewportRecheck();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") reconcileViewport();
  };
  const handleVisualViewportScroll = () => {
    if (
      appliedOverride === null &&
      !isKeyboardFocusTarget(document.activeElement)
    ) {
      return;
    }
    scheduleUpdate();
  };

  const handleFocusOut = (event: FocusEvent) => {
    if (!isKeyboardFocusTarget(event.target)) return;
    if (isKeyboardFocusTarget(event.relatedTarget)) return;
    if (
      restoreImmediatelyOnKeyboardDismissal &&
      viewportHeightBeforeKeyboard !== null &&
      (appliedKeyboardInset ||
        viewportHeightBeforeKeyboard - visualViewport.height >=
          KEYBOARD_OPEN_MIN_SHRINK_PX)
    ) {
      dismissedKeyboardBaseline = viewportHeightBeforeKeyboard;
      scheduleViewportRecheck();
    }
    viewportHeightBeforeKeyboard = null;
    setKeyboardInset(false);
    if (!restoreImmediatelyOnKeyboardDismissal) return;
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    clearViewportOverride();
  };
  const handleFocusIn = (event: FocusEvent) => {
    if (!isKeyboardFocusTarget(event.target)) return;
    if (viewportHeightBeforeKeyboard === null) {
      cancelViewportRecheck();
      viewportHeightBeforeKeyboard = Math.max(
        visualViewport.height,
        dismissedKeyboardBaseline ?? 0,
      );
      if (dismissedKeyboardBaseline !== null) scheduleViewportRecheck();
      dismissedKeyboardBaseline = null;
    }
    scheduleContainingBlockUpdate();
  };

  updateHeight();
  recheckDuringKeyboardResize();
  visualViewport.addEventListener("resize", handleVisualViewportResize);
  visualViewport.addEventListener("scroll", handleVisualViewportScroll);
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("orientationchange", reconcileViewport);
  if (restoreImmediatelyOnKeyboardDismissal) {
    window.addEventListener("pageshow", reconcileViewport);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  document.addEventListener("focusout", handleFocusOut);
  document.addEventListener("focusin", handleFocusIn);

  return () => {
    visualViewport.removeEventListener("resize", handleVisualViewportResize);
    visualViewport.removeEventListener("scroll", handleVisualViewportScroll);
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("orientationchange", reconcileViewport);
    window.removeEventListener("pageshow", reconcileViewport);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("focusout", handleFocusOut);
    document.removeEventListener("focusin", handleFocusIn);
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }
    cancelViewportRecheck();
    setKeyboardInset(false);
    clearViewportOverride();
  };
}

export function useMobileVisualViewportHeight(
  shell: AppShellElement | null,
  restoreImmediatelyOnKeyboardDismissal: boolean,
) {
  useEffect(() => {
    if (!shell) return;
    return attachMobileVisualViewportHeight(
      shell,
      restoreImmediatelyOnKeyboardDismissal,
    );
  }, [shell, restoreImmediatelyOnKeyboardDismissal]);
}
