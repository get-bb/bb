/**
 * Keeps foreign DOM mutation from killing the app.
 *
 * React owns every node it renders and remembers which parent each one belongs
 * to. On unmount it calls `parent.removeChild(node)` directly. When another
 * agent in the page — a browser extension's content script, the browser's own
 * page translator, a bookmarklet — moves or removes one of those nodes first,
 * React's call throws:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be
 *   removed is not a child of this node.
 *
 * React catches that throw in the commit phase and escalates it to the nearest
 * error boundary. bb had none above the router, so React tore the whole root
 * down and the user got a blank page. `AppErrorBoundary` now catches it and
 * shows a recovery screen, but a recovery screen still costs the user their
 * place for a mutation that only ever affected one subtree. This guard keeps
 * the fault from reaching that boundary at all.
 *
 * This guard makes both calls non-fatal. `removeChild` returns the node instead
 * of throwing when it already has a different parent (the node is gone from
 * where React expected it, which is exactly the outcome React wanted).
 * `insertBefore` appends instead of throwing when the reference node has moved
 * away, so the content still reaches the DOM rather than vanishing.
 *
 * This is the workaround React's own maintainers publish for translated pages
 * (facebook/react#11538). It is deliberately narrow: both wrappers only change
 * behavior in the case that would otherwise throw, so every well-formed call
 * reaches the native method unchanged.
 *
 * Suppressed calls are counted and the first few are logged, because a burst of
 * them from a build where no extension is involved would point at a real bug in
 * our own rendering instead.
 */

/** Log at most this many suppressions, then only keep counting. */
const MAX_LOGGED_SUPPRESSIONS = 3;

type RemoveChild = <T extends Node>(child: T) => T;
type InsertBefore = <T extends Node>(node: T, child: Node | null) => T;

interface InstalledGuard {
  removeChild: RemoveChild;
  insertBefore: InsertBefore;
}

let installed: InstalledGuard | null = null;
let suppressedCount = 0;
let loggedCount = 0;

/** How many throwing DOM calls the guard has absorbed this session. */
export function foreignDomMutationCount(): number {
  return suppressedCount;
}

function describe(node: Node): string {
  if (node instanceof Element) {
    const id = node.id ? `#${node.id}` : "";
    const testId = node.getAttribute("data-testid");
    return `<${node.localName}${id}${testId ? `[data-testid=${testId}]` : ""}>`;
  }
  if (node.nodeType === Node.TEXT_NODE) return "#text";
  return `#node(${node.nodeType})`;
}

function recordSuppression(
  operation: "removeChild" | "insertBefore",
  node: Node,
  expectedParent: Node,
): void {
  suppressedCount += 1;
  if (loggedCount >= MAX_LOGGED_SUPPRESSIONS) return;
  loggedCount += 1;
  console.warn(
    `[bb] ${operation}: ${describe(node)} is no longer a child of ${describe(
      expectedParent,
    )}. Something outside React moved or removed it (a browser extension or ` +
      `page translation is the usual cause); the call was suppressed instead ` +
      `of crashing the app.`,
    { node, expectedParent, actualParent: node.parentNode },
  );
}

/**
 * Wrap `Node.prototype.removeChild` / `insertBefore`. Safe to call more than
 * once; only the first call installs.
 */
export function installForeignDomMutationGuard(): void {
  if (installed !== null || typeof Node !== "function") return;

  const nativeRemoveChild = Node.prototype.removeChild;
  const nativeInsertBefore = Node.prototype.insertBefore;

  // Both wrappers return their own argument rather than the native return
  // value: the DOM spec defines each of these as returning the node it was
  // handed, so this keeps the generic result type without an `as` cast.
  const guardedRemoveChild: RemoveChild = function removeChild<T extends Node>(
    this: Node,
    child: T,
  ): T {
    if (child.parentNode !== this) {
      recordSuppression("removeChild", child, this);
      return child;
    }
    nativeRemoveChild.call(this, child);
    return child;
  };

  const guardedInsertBefore: InsertBefore = function insertBefore<
    T extends Node,
  >(this: Node, node: T, child: Node | null): T {
    if (child !== null && child.parentNode !== this) {
      recordSuppression("insertBefore", child, this);
      // Append rather than drop the node: the ordering is already wrong
      // because of the foreign mutation, but the content stays reachable.
      nativeInsertBefore.call(this, node, null);
      return node;
    }
    nativeInsertBefore.call(this, node, child);
    return node;
  };

  Node.prototype.removeChild = guardedRemoveChild;
  Node.prototype.insertBefore = guardedInsertBefore;
  installed = { removeChild: nativeRemoveChild, insertBefore: nativeInsertBefore };
}

/** Restore the native methods and the counters. Test-only. */
export function uninstallForeignDomMutationGuardForTest(): void {
  if (installed === null) return;
  Node.prototype.removeChild = installed.removeChild;
  Node.prototype.insertBefore = installed.insertBefore;
  installed = null;
  suppressedCount = 0;
  loggedCount = 0;
}
