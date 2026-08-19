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

export function closestEventElement(
  target: EventTarget | null,
): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function isEditableTarget(target: Element | null): boolean {
  return (
    target?.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function isSelectionControlTarget(target: Element | null): boolean {
  const control = target?.closest(SELECTION_CONTROL_SELECTOR);
  if (control === null || control === undefined) return false;
  return !control.classList.contains("select-text");
}

export function preservesNativeSelectAll(target: Element | null): boolean {
  return isEditableTarget(target) || isSelectionControlTarget(target);
}

export function findSelectAllScope(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>(SELECT_ALL_SCOPE_SELECTOR);
}

function isSkippedSelectionSubtree(element: Element): boolean {
  return (
    preservesNativeSelectAll(element) ||
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

function getComposedTextEndpoints(scope: HTMLElement): {
  first: Text;
  last: Text;
} | null {
  let first: Text | null = null;
  let last: Text | null = null;

  function visit(node: Node) {
    if (node instanceof Text) {
      if (node.data.length === 0) return;
      first ??= node;
      last = node;
      return;
    }
    if (
      node !== scope &&
      node instanceof Element &&
      isSkippedSelectionSubtree(node)
    ) {
      return;
    }
    for (const child of getComposedChildren(node)) visit(child);
  }

  visit(scope);
  return first === null || last === null ? null : { first, last };
}

export function selectAllScopeContents(scope: HTMLElement): void {
  const endpoints = getComposedTextEndpoints(scope);
  const selection = window.getSelection();
  if (endpoints === null || selection === null) return;
  selection.setBaseAndExtent(
    endpoints.first,
    0,
    endpoints.last,
    endpoints.last.data.length,
  );
}
