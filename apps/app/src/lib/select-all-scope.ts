const SELECT_ALL_SCOPE_SELECTOR = "[data-select-all-scope]";

const SELECTION_CONTROL_SELECTOR = [
  "button",
  "select",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

const NON_EDITING_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
export function closestEventElement(
  target: EventTarget | null,
): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

export function isEditableTarget(target: Element | null): boolean {
  if (target === null) return false;
  if (target.closest("select[multiple]") !== null) return true;
  const input = target.closest<HTMLInputElement>("input");
  if (input !== null) return !NON_EDITING_INPUT_TYPES.has(input.type);
  return (
    target.closest(
      'textarea, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function isEditableSelectionSubtree(element: Element): boolean {
  if (element.matches("select[multiple]")) return true;
  if (element instanceof HTMLInputElement) {
    return !NON_EDITING_INPUT_TYPES.has(element.type);
  }
  return element.matches(
    'textarea, [contenteditable]:not([contenteditable="false"])',
  );
}

export function findSelectAllScope(
  composedPath: readonly EventTarget[],
): HTMLElement | null {
  for (const target of composedPath) {
    if (!(target instanceof Element)) continue;
    const scope = target.closest<HTMLElement>(SELECT_ALL_SCOPE_SELECTOR);
    if (scope !== null) return scope;
  }
  return null;
}

function isSkippedSelectionSubtree(element: Element): boolean {
  return (
    (element.matches(SELECTION_CONTROL_SELECTOR) &&
      !element.classList.contains("select-text")) ||
    element.matches('script, style, template, [hidden], [aria-hidden="true"]')
  );
}

function getComposedChildren(node: Node): readonly Node[] {
  if (node instanceof HTMLSlotElement) {
    const assignedNodes = node.assignedNodes({ flatten: true });
    if (assignedNodes.length > 0) return assignedNodes;
  }
  if (node instanceof Element && node.shadowRoot !== null) {
    return Array.from(node.shadowRoot.childNodes);
  }
  return Array.from(node.childNodes);
}

function getComposedTextEndpoints(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
  selectionAnchor: Element,
): {
  first: Text;
  last: Text;
} | null {
  let first: Text | null = null;
  let last: Text | null = null;
  let segment = 0;
  let anchorSegment: number | null = null;
  const textBySegment = new Map<number, Text[]>();

  function visit(node: Node) {
    if (node === selectionAnchor) {
      anchorSegment = segment;
    }
    if (node instanceof Text) {
      if (node.data.length === 0 || node.getRootNode() !== selectionRoot)
        return;
      const segmentText = textBySegment.get(segment) ?? [];
      segmentText.push(node);
      textBySegment.set(segment, segmentText);
      return;
    }
    if (node !== scope && node instanceof Element) {
      if (isEditableSelectionSubtree(node)) {
        if (node.contains(selectionAnchor)) {
          anchorSegment = segment;
        }
        segment += 1;
        return;
      }
      if (isSkippedSelectionSubtree(node)) {
        if (node.contains(selectionAnchor)) {
          anchorSegment = segment;
        }
        return;
      }
    }
    for (const child of getComposedChildren(node)) visit(child);
  }

  visit(scope);
  const selectedText = textBySegment.get(anchorSegment ?? 0) ?? [];
  first = selectedText[0] ?? null;
  last = selectedText.at(-1) ?? null;
  return first === null || last === null ? null : { first, last };
}

export function resolveSelectAllRoot(
  scope: HTMLElement,
  preferredRoot: Document | ShadowRoot,
): Document | ShadowRoot {
  const textRoots = new Set<Document | ShadowRoot>();

  function visit(node: Node) {
    if (node instanceof Text) {
      if (node.data.trim().length === 0) return;
      const root = node.getRootNode();
      if (root instanceof Document || root instanceof ShadowRoot) {
        textRoots.add(root);
      }
      return;
    }
    if (node !== scope && node instanceof Element) {
      if (isEditableSelectionSubtree(node) || isSkippedSelectionSubtree(node)) {
        return;
      }
    }
    for (const child of getComposedChildren(node)) visit(child);
  }

  visit(scope);
  if (textRoots.has(preferredRoot) || textRoots.size !== 1) {
    return preferredRoot;
  }
  return textRoots.values().next().value ?? preferredRoot;
}

export function selectAllScopeContents(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
  selectionAnchor: Element,
): void {
  const endpoints = getComposedTextEndpoints(
    scope,
    selectionRoot,
    selectionAnchor,
  );
  const selection = window.getSelection();
  if (endpoints === null || selection === null) return;
  selection.setBaseAndExtent(
    endpoints.first,
    0,
    endpoints.last,
    endpoints.last.data.length,
  );
}
