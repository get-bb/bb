const composerFocusTargets = new WeakMap<HTMLElement, () => void>();

export function registerPaneComposerFocus(
  element: HTMLElement,
  focus: () => void,
): () => void {
  composerFocusTargets.set(element, focus);
  return () => {
    composerFocusTargets.delete(element);
  };
}

export function focusPaneComposer(element: HTMLElement): void {
  const focus = composerFocusTargets.get(element);
  if (focus) focus();
  else element.focus({ preventScroll: true });
}
