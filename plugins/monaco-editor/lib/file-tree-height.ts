/**
 * The file tree's height, which the user drags. Kept out of the component so
 * the clamping rules are testable without a layout engine.
 */

/** Matches the fixed `max-h-64` the panel shipped with before it could resize. */
export const DEFAULT_TREE_HEIGHT = 256;

/** Below this the tree shows its filter box and nothing usable under it. */
export const MIN_TREE_HEIGHT = 96;

/** Room the toolbar, any notice row, and a few code lines always keep. */
export const MIN_EDITOR_HEIGHT = 120;

const STORAGE_KEY = "bb-plugin-monaco-editor:file-tree-height";

/**
 * Fit a requested height into what the surface can give. A pane too short to
 * honour both minimums gives the tree its minimum and lets the editor take
 * what is left: a tree dragged out of reach is worse than a short editor the
 * user can drag back.
 */
export function clampTreeHeight(height: number, available: number): number {
  const max = Math.max(MIN_TREE_HEIGHT, available - MIN_EDITOR_HEIGHT);
  return Math.round(Math.min(Math.max(height, MIN_TREE_HEIGHT), max));
}

/**
 * The height this window last left the tree at. Persisted rather than held in
 * React state because the panel unmounts every time the user hides it, and a
 * resize the user made should survive that — and reopening the file in a new
 * tab.
 */
export function readStoredTreeHeight(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_TREE_HEIGHT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TREE_HEIGHT;
    return Math.max(parsed, MIN_TREE_HEIGHT);
  } catch {
    // Storage can throw outright in a partitioned or storage-blocked context.
    return DEFAULT_TREE_HEIGHT;
  }
}

export function storeTreeHeight(height: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // A height that cannot be remembered is not worth failing a drag over.
  }
}
