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

const SHADOW_SELECTION_POLICY_ATTRIBUTE = "data-bb-app-selection-policy";
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
const SHADOW_SELECTION_POLICY = `
  :where(input, textarea, [contenteditable]:not([contenteditable="false"])) {
    user-select: text !important;
  }
  :where(${SELECTION_CONTROL_SELECTOR}):not(.select-text) {
    user-select: none !important;
  }
`;

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

function isSelectionControlTarget(target: Element | null): boolean {
  const control = target?.closest(SELECTION_CONTROL_SELECTOR);
  if (control === null || control === undefined) return false;
  return !control.classList.contains("select-text");
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
    isEditableTarget(element) ||
    isSelectionControlTarget(element) ||
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

export function applyOpenShadowSelectionPolicy(
  selectionRoot: ShadowRoot,
): void {
  if (
    selectionRoot.querySelector(
      `style[${SHADOW_SELECTION_POLICY_ATTRIBUTE}]`,
    ) !== null
  ) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(SHADOW_SELECTION_POLICY_ATTRIBUTE, "");
  style.textContent = SHADOW_SELECTION_POLICY;
  selectionRoot.append(style);
}

function getComposedTextEndpoints(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
): {
  first: Text;
  last: Text;
} | null {
  let first: Text | null = null;
  let last: Text | null = null;

  function visit(node: Node) {
    if (node instanceof Text) {
      if (node.data.length === 0 || node.getRootNode() !== selectionRoot)
        return;
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

export function selectAllScopeContents(
  scope: HTMLElement,
  selectionRoot: Document | ShadowRoot,
): void {
  const endpoints = getComposedTextEndpoints(scope, selectionRoot);
  const selection = window.getSelection();
  if (endpoints === null || selection === null) return;
  selection.setBaseAndExtent(
    endpoints.first,
    0,
    endpoints.last,
    endpoints.last.data.length,
  );
}
