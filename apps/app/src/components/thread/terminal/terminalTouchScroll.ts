// xterm 6 never wires touch-drag scrolling to its viewport: the bundled VS Code
// Gesture helper is defined but never given a target, and the `.xterm-screen`
// layer is painted above the scrollable `.xterm-viewport`, so a finger swipe
// lands on the screen and the viewport never scrolls (only the wheel and the
// scrollbar do). Bridge a vertical touch drag on the screen to the viewport's
// scrollTop, which is exactly what dragging the scrollbar does, so swiping
// scrolls the terminal like any other list.

// Movement (px) a drag must cross before it scrolls, so a tap still focuses the
// terminal and raises the keyboard instead of being swallowed as a scroll.
export const TERMINAL_TOUCH_SCROLL_INTENT_PX = 4;

export function attachTerminalTouchScroll(
  containerElement: HTMLElement,
): () => void {
  const screen = containerElement.querySelector<HTMLElement>(".xterm-screen");
  const viewport =
    containerElement.querySelector<HTMLElement>(".xterm-viewport");
  if (screen === null || viewport === null) {
    return () => {};
  }

  let lastY: number | null = null;
  let engaged = false;

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      lastY = null;
      return;
    }
    lastY = event.touches[0]?.clientY ?? null;
    engaged = false;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (lastY === null || event.touches.length !== 1) {
      return;
    }
    const y = event.touches[0]?.clientY;
    if (y === undefined) {
      return;
    }
    if (!engaged) {
      if (Math.abs(y - lastY) < TERMINAL_TOUCH_SCROLL_INTENT_PX) {
        return;
      }
      // Nothing to scroll: leave the gesture alone rather than trap it.
      if (viewport.scrollHeight <= viewport.clientHeight) {
        return;
      }
      engaged = true;
    }
    // Dragging down reveals earlier scrollback, matching native list scrolling.
    viewport.scrollTop -= y - lastY;
    lastY = y;
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const endGesture = () => {
    lastY = null;
    engaged = false;
  };

  screen.addEventListener("touchstart", onTouchStart, { passive: true });
  screen.addEventListener("touchmove", onTouchMove, { passive: false });
  screen.addEventListener("touchend", endGesture);
  screen.addEventListener("touchcancel", endGesture);
  return () => {
    screen.removeEventListener("touchstart", onTouchStart);
    screen.removeEventListener("touchmove", onTouchMove);
    screen.removeEventListener("touchend", endGesture);
    screen.removeEventListener("touchcancel", endGesture);
  };
}
