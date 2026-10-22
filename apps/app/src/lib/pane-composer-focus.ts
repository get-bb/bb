const composerFocusTargets = new Map<HTMLElement, () => boolean>();

export function registerPaneComposerFocus(
  root: HTMLElement,
  focus: () => boolean,
): () => void {
  composerFocusTargets.set(root, focus);
  return () => {
    if (composerFocusTargets.get(root) === focus) {
      composerFocusTargets.delete(root);
    }
  };
}

export function focusPaneComposer(container: HTMLElement): boolean {
  const roots = [...composerFocusTargets.keys()]
    .filter((root) => container.contains(root))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  return roots.some((root) => composerFocusTargets.get(root)?.() === true);
}

export function composerRootWithin(container: HTMLElement): HTMLElement | null {
  for (const root of composerFocusTargets.keys()) {
    if (container.contains(root)) return root;
  }
  return null;
}
