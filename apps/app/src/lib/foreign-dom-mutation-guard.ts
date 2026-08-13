/**
 * Keeps foreign DOM mutation from killing the app.
 *
 * React owns every node it renders and remembers which parent each one belongs
 * to. On unmount it calls `parent.removeChild(node)` directly. When another
 * agent in the page — a browser extension's content script, a plugin content
 * script, the browser's own page translator, a bookmarklet — moves or removes
 * one of those nodes first, React's call throws:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be
 *   removed is not a child of this node.
 *
 * React catches that throw in the commit phase and escalates it to the nearest
 * error boundary. List updates are worse: `insertBefore` during placement is
 * not wrapped, so a stolen reference node blanks the window even when
 * `AppErrorBoundary` would have caught a deletion. This guard keeps both
 * faults from reaching that boundary.
 *
 * `removeChild` returns the node instead of throwing when it already has a
 * different parent. `insertBefore` appends instead of throwing when the
 * reference node has moved away. `replaceChild` does the same when the node
 * it would replace is gone. Wrappers only change the case that would throw.
 *
 * Plugin content scripts are a second, tighter layer. While one of those
 * scripts (or a MutationObserver it created) runs, the guard also refuses to
 * move a React-owned node to a new parent. That stops the wrap-then-remove
 * crash at the source: the plugin can still insert its own sibling controls,
 * but it cannot steal a host button or link out of React's tree.
 *
 * This is the workaround React's own maintainers publish for translated pages
 * (facebook/react#11538), plus a host-side fence for trusted plugin scripts
 * that still share the document.
 *
 * Suppressed calls are counted and the first few are logged, because a burst
 * of them from a build where no extension or plugin is involved would point
 * at a real bug in our own rendering instead.
 */

/** Log at most this many suppressions, then only keep counting. */
const MAX_LOGGED_SUPPRESSIONS = 3;

const REACT_FIBER_PREFIXES = [
  "__reactFiber$",
  "__reactInternalInstance$",
] as const;

type RemoveChild = <T extends Node>(child: T) => T;
type InsertBefore = <T extends Node>(node: T, child: Node | null) => T;
type ReplaceChild = <T extends Node>(node: Node, child: T) => T;
type AppendChild = <T extends Node>(node: T) => T;
type AppendLike = (...nodes: Array<Node | string>) => void;

interface InstalledGuard {
  restore: () => void;
}

let installed: InstalledGuard | null = null;
let suppressedCount = 0;
let loggedCount = 0;
let refusedMoveCount = 0;
let loggedRefusalCount = 0;
let isolationDepth = 0;
let isolationLabel: string | null = null;

/** How many throwing DOM calls the guard has absorbed this session. */
export function foreignDomMutationCount(): number {
  return suppressedCount;
}

/**
 * How many times a plugin content script was stopped from moving a React-owned
 * node out of the tree.
 */
export function pluginHostNodeMoveRefusalCount(): number {
  return refusedMoveCount;
}

function describeNode(node: Node): string {
  if (node instanceof Element) {
    const id = node.id ? `#${node.id}` : "";
    const testId = node.getAttribute("data-testid");
    return `<${node.localName}${id}${testId ? `[data-testid=${testId}]` : ""}>`;
  }
  if (node.nodeType === Node.TEXT_NODE) return "#text";
  return `#node(${node.nodeType})`;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function isHierarchyRequestError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "HierarchyRequestError"
  );
}

function isReactHostNode(node: Node): boolean {
  for (const key of Object.getOwnPropertyNames(node)) {
    for (const prefix of REACT_FIBER_PREFIXES) {
      if (key.startsWith(prefix)) return true;
    }
  }
  return false;
}

function recordSuppression(
  operation: "removeChild" | "insertBefore" | "replaceChild",
  node: Node,
  expectedParent: Node,
): void {
  suppressedCount += 1;
  if (loggedCount >= MAX_LOGGED_SUPPRESSIONS) return;
  loggedCount += 1;
  console.warn(
    `[bb] ${operation}: ${describeNode(node)} is no longer a child of ${describeNode(
      expectedParent,
    )}. Something outside React moved or removed it (a browser extension, ` +
      `plugin content script, or page translation is the usual cause); the ` +
      `call was suppressed instead of crashing the app.`,
    { node, expectedParent, actualParent: node.parentNode },
  );
}

function recordRefusedMove(node: Node, attemptedParent: Node): void {
  refusedMoveCount += 1;
  if (loggedRefusalCount >= MAX_LOGGED_SUPPRESSIONS) return;
  loggedRefusalCount += 1;
  const owner =
    isolationLabel === null
      ? "a plugin content script"
      : `plugin "${isolationLabel}"`;
  console.warn(
    `[bb] ${owner} tried to move ${describeNode(node)} out of React's tree. The ` +
      `move was blocked so the app does not crash when that node is later ` +
      `removed or reordered.`,
    { node, attemptedParent, actualParent: node.parentNode },
  );
}

/**
 * True when a plugin script is trying to adopt a React-owned node into a
 * different parent. Fresh nodes and same-parent reorders stay allowed.
 */
function refusePluginReparent(node: Node, newParent: Node): boolean {
  if (isolationDepth === 0) return false;
  if (node.parentNode === null || node.parentNode === newParent) return false;
  if (!isReactHostNode(node)) return false;
  recordRefusedMove(node, newParent);
  return true;
}

/**
 * Run `fn` as plugin content-script DOM. React-owned nodes cannot be moved to
 * a new parent for the duration of the synchronous call. MutationObservers
 * created here keep the same rule when they later fire. Do not hold this
 * across an `await`: a React commit that lands in the gap must still be able
 * to reorder its own nodes.
 */
export function runWithPluginDomIsolation<T>(fn: () => T, label?: string): T {
  const previousLabel = isolationLabel;
  isolationDepth += 1;
  if (label !== undefined) isolationLabel = label;
  try {
    return fn();
  } finally {
    isolationDepth -= 1;
    isolationLabel = previousLabel;
  }
}

function filterAppendNodes(
  parent: Node,
  nodes: Array<Node | string>,
): Array<Node | string> {
  if (isolationDepth === 0) return nodes;
  const kept: Array<Node | string> = [];
  for (const node of nodes) {
    if (typeof node !== "string" && refusePluginReparent(node, parent)) {
      continue;
    }
    kept.push(node);
  }
  return kept;
}

/**
 * Wrap the DOM methods React (and plugins) use to move nodes. Safe to call
 * more than once; only the first call installs.
 */
export function installForeignDomMutationGuard(): void {
  if (installed !== null || typeof Node !== "function") return;

  const nativeRemoveChild = Node.prototype.removeChild;
  const nativeInsertBefore = Node.prototype.insertBefore;
  const nativeReplaceChild = Node.prototype.replaceChild;
  const nativeAppendChild = Node.prototype.appendChild;
  const nativeElementAppend = Element.prototype.append;
  const nativeElementPrepend = Element.prototype.prepend;
  const nativeElementBefore = Element.prototype.before;
  const nativeElementAfter = Element.prototype.after;
  const nativeElementReplaceWith = Element.prototype.replaceWith;
  const nativeDocumentAppend = Document.prototype.append;
  const nativeDocumentPrepend = Document.prototype.prepend;
  const nativeFragmentAppend = DocumentFragment.prototype.append;
  const nativeFragmentPrepend = DocumentFragment.prototype.prepend;
  const NativeMutationObserver =
    typeof MutationObserver === "function" ? MutationObserver : null;

  // Wrappers return their own argument rather than the native return value:
  // the DOM spec defines each of these as returning the node it was handed,
  // so this keeps the generic result type without an `as` cast.
  const guardedRemoveChild: RemoveChild = function removeChild<T extends Node>(
    this: Node,
    child: T,
  ): T {
    if (child.parentNode !== this) {
      recordSuppression("removeChild", child, this);
      return child;
    }
    try {
      nativeRemoveChild.call(this, child);
    } catch (error) {
      if (isNotFoundError(error)) {
        recordSuppression("removeChild", child, this);
        return child;
      }
      throw error;
    }
    return child;
  };

  const guardedInsertBefore: InsertBefore = function insertBefore<
    T extends Node,
  >(this: Node, node: T, child: Node | null): T {
    if (refusePluginReparent(node, this)) return node;
    if (child !== null && child.parentNode !== this) {
      recordSuppression("insertBefore", child, this);
      try {
        nativeInsertBefore.call(this, node, null);
      } catch (error) {
        if (!isNotFoundError(error) && !isHierarchyRequestError(error)) {
          throw error;
        }
      }
      return node;
    }
    try {
      nativeInsertBefore.call(this, node, child);
    } catch (error) {
      if (isNotFoundError(error)) {
        recordSuppression("insertBefore", child ?? node, this);
        return node;
      }
      throw error;
    }
    return node;
  };

  const guardedReplaceChild: ReplaceChild = function replaceChild<
    T extends Node,
  >(this: Node, node: Node, child: T): T {
    if (refusePluginReparent(node, this)) return child;
    if (child.parentNode !== this) {
      recordSuppression("replaceChild", child, this);
      if (node.parentNode !== this && !refusePluginReparent(node, this)) {
        try {
          nativeInsertBefore.call(this, node, null);
        } catch (error) {
          if (!isNotFoundError(error) && !isHierarchyRequestError(error)) {
            throw error;
          }
        }
      }
      return child;
    }
    try {
      nativeReplaceChild.call(this, node, child);
    } catch (error) {
      if (isNotFoundError(error)) {
        recordSuppression("replaceChild", child, this);
        return child;
      }
      throw error;
    }
    return child;
  };

  const guardedAppendChild: AppendChild = function appendChild<T extends Node>(
    this: Node,
    node: T,
  ): T {
    if (refusePluginReparent(node, this)) return node;
    nativeAppendChild.call(this, node);
    return node;
  };

  const guardedParentAppend = (native: AppendLike): AppendLike =>
    function append(this: ParentNode, ...nodes: Array<Node | string>): void {
      const kept = filterAppendNodes(this, nodes);
      if (kept.length === 0) return;
      native.apply(this, kept);
    };

  const guardedAdjacent = (
    native: AppendLike,
    resolveParent: (self: Element) => Node | null,
  ): AppendLike =>
    function adjacent(this: Element, ...nodes: Array<Node | string>): void {
      const parent = resolveParent(this) ?? this;
      const kept = filterAppendNodes(parent, nodes);
      if (kept.length === 0) return;
      native.apply(this, kept);
    };

  Node.prototype.removeChild = guardedRemoveChild;
  Node.prototype.insertBefore = guardedInsertBefore;
  Node.prototype.replaceChild = guardedReplaceChild;
  Node.prototype.appendChild = guardedAppendChild;
  Element.prototype.append = guardedParentAppend(nativeElementAppend);
  Element.prototype.prepend = guardedParentAppend(nativeElementPrepend);
  Element.prototype.before = guardedAdjacent(
    nativeElementBefore,
    (self) => self.parentNode,
  );
  Element.prototype.after = guardedAdjacent(
    nativeElementAfter,
    (self) => self.parentNode,
  );
  Element.prototype.replaceWith = guardedAdjacent(
    nativeElementReplaceWith,
    (self) => self.parentNode,
  );
  Document.prototype.append = guardedParentAppend(nativeDocumentAppend);
  Document.prototype.prepend = guardedParentAppend(nativeDocumentPrepend);
  DocumentFragment.prototype.append = guardedParentAppend(nativeFragmentAppend);
  DocumentFragment.prototype.prepend = guardedParentAppend(
    nativeFragmentPrepend,
  );

  if (NativeMutationObserver !== null) {
    // Construct a real native observer. A subclass can break jsdom and leave
    // React's `act()` waiting for a callback that never runs.
    const IsolatedMutationObserver = function IsolatedMutationObserver(
      callback: MutationCallback,
    ): MutationObserver {
      const label = isolationLabel;
      const wrapped: MutationCallback =
        isolationDepth > 0
          ? (records, observer) => {
              runWithPluginDomIsolation(
                () => callback(records, observer),
                label ?? undefined,
              );
            }
          : callback;
      return new NativeMutationObserver(wrapped);
    };
    IsolatedMutationObserver.prototype = NativeMutationObserver.prototype;
    window.MutationObserver =
      IsolatedMutationObserver as unknown as typeof MutationObserver;
  }

  installed = {
    restore: () => {
      Node.prototype.removeChild = nativeRemoveChild;
      Node.prototype.insertBefore = nativeInsertBefore;
      Node.prototype.replaceChild = nativeReplaceChild;
      Node.prototype.appendChild = nativeAppendChild;
      Element.prototype.append = nativeElementAppend;
      Element.prototype.prepend = nativeElementPrepend;
      Element.prototype.before = nativeElementBefore;
      Element.prototype.after = nativeElementAfter;
      Element.prototype.replaceWith = nativeElementReplaceWith;
      Document.prototype.append = nativeDocumentAppend;
      Document.prototype.prepend = nativeDocumentPrepend;
      DocumentFragment.prototype.append = nativeFragmentAppend;
      DocumentFragment.prototype.prepend = nativeFragmentPrepend;
      if (NativeMutationObserver !== null) {
        window.MutationObserver = NativeMutationObserver;
      }
    },
  };
}

/** Restore the native methods and the counters. Test-only. */
export function uninstallForeignDomMutationGuardForTest(): void {
  if (installed === null) return;
  installed.restore();
  installed = null;
  suppressedCount = 0;
  loggedCount = 0;
  refusedMoveCount = 0;
  loggedRefusalCount = 0;
  isolationDepth = 0;
  isolationLabel = null;
}
