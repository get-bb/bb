import { useEffect, useSyncExternalStore } from "react";

export type RehypeKatex = typeof import("./markdown-katex.js").default;

// `remark-math` runs with `singleDollarTextMath: false` (see markdown-preview),
// so every math construct — inline `$$x$$` and display `$$` blocks — contains
// this token. Content without it cannot produce a math node, and a false
// positive ("costs $$$") only costs an early chunk load.
const MATH_DELIMITER = "$$";

export function markdownMayContainMath(content: string): boolean {
  return content.includes(MATH_DELIMITER);
}

let loadedRehypeKatex: RehypeKatex | null = null;
let rehypeKatexImportPromise: Promise<RehypeKatex> | null = null;
const listeners = new Set<() => void>();

export function loadRehypeKatex(): Promise<RehypeKatex> {
  if (rehypeKatexImportPromise === null) {
    rehypeKatexImportPromise = import("./markdown-katex.js").then(
      (katexModule) => {
        loadedRehypeKatex = katexModule.default;
        for (const listener of listeners) listener();
        return katexModule.default;
      },
      (error: unknown) => {
        // Drop the rejected promise so the next preview that needs math
        // retries the network instead of failing forever.
        rehypeKatexImportPromise = null;
        throw error;
      },
    );
  }
  return rehypeKatexImportPromise;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): RehypeKatex | null {
  return loadedRehypeKatex;
}

/**
 * Returns the `rehype-katex` plugin once it has loaded, or `null` while the
 * lazy chunk is in flight (or was never requested). The first preview whose
 * content may contain math kicks off the import; every mounted preview
 * re-renders with the plugin as soon as it resolves. Loading is process-wide,
 * so later previews get the plugin synchronously on their first render.
 */
export function useRehypeKatex(mayContainMath: boolean): RehypeKatex | null {
  const rehypeKatex = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!mayContainMath || rehypeKatex !== null) return;
    loadRehypeKatex().catch(() => {
      // The math stays in its `remark-math` code fallback for this preview.
    });
  }, [mayContainMath, rehypeKatex]);
  return rehypeKatex;
}
