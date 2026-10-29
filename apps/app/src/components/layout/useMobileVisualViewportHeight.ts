import { useEffect } from "react";

type AppShellElement = HTMLDivElement;

export const SHELL_SAFE_AREA_BOTTOM_PROPERTY = "--bb-safe-area-bottom";

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

function repaintMovedEditableCaret(document: Document) {
  const editable = document.activeElement;
  if (!(editable instanceof HTMLElement) || !editable.isContentEditable) {
    return;
  }
  const selection = document.getSelection();
  if (
    !selection ||
    selection.rangeCount !== 1 ||
    !selection.isCollapsed ||
    !editable.contains(selection.anchorNode)
  ) {
    return;
  }
  const range = selection.getRangeAt(0).cloneRange();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function useMobileVisualViewportHeight(
  shell: AppShellElement | null,
  enabled: boolean,
  restoreImmediatelyOnKeyboardDismissal: boolean,
) {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!shell || !enabled || !visualViewport) return;
    const viewportStyleRoot = shell.ownerDocument.body;

    let animationFrame: number | null = null;
    let appliedOverride: { top: number; height: number } | null = null;
    let shellContainingBlockHeight = 0;
    let shellContainingBlockHeightStale = true;
    let viewportHeightBeforeKeyboard: number | null = null;
    let appliedKeyboardInset = false;
    let caretRefreshFrame: number | null = null;
    let disposed = false;
    let typedSinceFocus = isKeyboardFocusTarget(document.activeElement);
    const cancelCaretRefresh = () => {
      if (caretRefreshFrame === null) return;
      window.cancelAnimationFrame(caretRefreshFrame);
      caretRefreshFrame = null;
    };
    const scheduleCaretRefresh = () => {
      if (
        disposed ||
        typedSinceFocus ||
        !isKeyboardFocusTarget(document.activeElement)
      ) {
        return;
      }
      cancelCaretRefresh();
      caretRefreshFrame = window.requestAnimationFrame(() => {
        caretRefreshFrame = null;
        if (typedSinceFocus) return;
        repaintMovedEditableCaret(document);
      });
    };
    const setKeyboardInset = (open: boolean) => {
      if (open === appliedKeyboardInset) return;
      appliedKeyboardInset = open;
      scheduleCaretRefresh();
      if (open) {
        viewportStyleRoot.style.setProperty(
          SHELL_SAFE_AREA_BOTTOM_PROPERTY,
          "0px",
        );
      } else {
        viewportStyleRoot.style.removeProperty(SHELL_SAFE_AREA_BOTTOM_PROPERTY);
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
      scheduleCaretRefresh();
      shell.style.removeProperty("top");
      shell.style.removeProperty("height");
      viewportStyleRoot.style.removeProperty("--bb-shell-height");
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
        shellContainingBlockHeight = document.body.clientHeight;
        shellContainingBlockHeightStale = false;
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
        scheduleCaretRefresh();
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
      scheduleCaretRefresh();
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
      viewportHeightBeforeKeyboard = null;
      setKeyboardInset(false);
      cancelCaretRefresh();
      if (!restoreImmediatelyOnKeyboardDismissal) return;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      clearViewportOverride();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isKeyboardFocusTarget(event.target)) return;
      typedSinceFocus = false;
      viewportHeightBeforeKeyboard ??= visualViewport.height;
      scheduleContainingBlockUpdate();
    };

    const handleInput = () => {
      typedSinceFocus = true;
      cancelCaretRefresh();
    };

    updateHeight();
    visualViewport.addEventListener("resize", scheduleUpdate);
    visualViewport.addEventListener("scroll", handleVisualViewportScroll);
    window.addEventListener("resize", scheduleContainingBlockUpdate);
    window.addEventListener("orientationchange", scheduleContainingBlockUpdate);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("compositionstart", handleInput);
    document.addEventListener("input", handleInput);

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
      document.removeEventListener("compositionstart", handleInput);
      document.removeEventListener("input", handleInput);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      disposed = true;
      cancelCaretRefresh();
      setKeyboardInset(false);
      clearViewportOverride();
    };
  }, [enabled, restoreImmediatelyOnKeyboardDismissal, shell]);
}
