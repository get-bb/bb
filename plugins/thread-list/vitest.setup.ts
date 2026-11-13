if (
  typeof document !== "undefined" &&
  typeof document.elementFromPoint !== "function"
) {
  let lastPressTarget: Element | null = null;
  const recordPressTarget = (event: Event) => {
    lastPressTarget = event.target instanceof Element ? event.target : null;
  };
  document.addEventListener("pointerdown", recordPressTarget, true);
  document.addEventListener("touchstart", recordPressTarget, true);
  document.elementFromPoint = function elementFromPointPolyfill() {
    return lastPressTarget?.isConnected === true
      ? lastPressTarget
      : document.body;
  };
}
