import type { Mermaid } from "mermaid";

let mermaidImportPromise: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  if (mermaidImportPromise === null) {
    mermaidImportPromise = import("mermaid").then(
      (mermaidModule) => mermaidModule.default,
    );
  }

  return mermaidImportPromise;
}
