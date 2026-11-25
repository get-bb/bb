import { useMemo, useState } from "react";
import { CopyButton } from "./copy-button.js";
import { cn } from "@bb/shared-ui/lib/utils";

export interface MarkdownInlineVisDiagramProps {
  source: string;
}

const DEFAULT_HEIGHT_PX = 320;
const MIN_HEIGHT_PX = 80;
const MAX_HEIGHT_PX = 900;

function estimateDiagramHeightPx(source: string): number {
  const viewBoxMatch = source.match(
    /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i,
  );
  if (viewBoxMatch) {
    const height = Number(viewBoxMatch[2]);
    if (Number.isFinite(height) && height > 0) {
      return Math.min(
        MAX_HEIGHT_PX,
        Math.max(MIN_HEIGHT_PX, Math.ceil(height) + 24),
      );
    }
  }
  const heightAttrMatch = source.match(/\bheight\s*=\s*["']\s*(\d+)(?:px)?\s*["']/i);
  if (heightAttrMatch) {
    const height = Number(heightAttrMatch[1]);
    if (Number.isFinite(height) && height > 0) {
      return Math.min(
        MAX_HEIGHT_PX,
        Math.max(MIN_HEIGHT_PX, Math.ceil(height) + 24),
      );
    }
  }
  return DEFAULT_HEIGHT_PX;
}

function buildInlineVisSrcDoc(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 8px; background: #ffffff; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-sizing: border-box; }
svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
</style></head><body>${source}</body></html>`;
}

export function MarkdownInlineVisDiagram({
  source,
}: MarkdownInlineVisDiagramProps) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const srcDoc = useMemo(() => buildInlineVisSrcDoc(source), [source]);
  const heightPx = useMemo(() => estimateDiagramHeightPx(source), [source]);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-surface-recessed">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-xs uppercase text-muted-foreground">
          diagram
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setMode((current) =>
                current === "preview" ? "source" : "preview",
              )
            }
            className="cursor-pointer font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "preview" ? "Source" : "Preview"}
          </button>
          <CopyButton text={source} label="Copy diagram source" />
        </div>
      </div>
      {mode === "preview" ? (
        <iframe
          title="Inline diagram preview"
          sandbox=""
          srcDoc={srcDoc}
          style={{ height: `${heightPx}px` }}
          className="block w-full border-0 bg-white"
        />
      ) : (
        <pre
          className={cn(
            "bb-code-highlight overflow-x-auto px-3 py-3 text-xs",
          )}
        >
          <code>{source}</code>
        </pre>
      )}
    </div>
  );
}
