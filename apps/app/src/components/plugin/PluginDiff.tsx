import { useMemo } from "react";
import type { DiffProps } from "@get-bb/plugin-sdk";
import { DiffHost } from "@/components/code/DiffHost";
import { normalizeFilePatch } from "@/components/git-diff/git-diff-parsing";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * The public `experimental_Diff` component. It normalizes whatever patch shape
 * the caller has (a `git diff` patch, a GitHub REST patch, a single `@@` hunk)
 * into one the renderer understands, then hands it to the host boundary.
 * Content that does not parse as a patch degrades to plain monospace text
 * rather than to an empty diff. Full-file enrichment stays behind the lazy
 * built-in renderer so a replacement that never delegates pays none of its
 * parsing cost.
 */
export function PluginDiff({
  patch,
  path,
  view,
  overflow,
  showLineNumbers,
  experimental_fullFileContents: fullFileContents,
  className,
}: DiffProps) {
  const normalized = useMemo(
    () => normalizeFilePatch({ patch, path }),
    [patch, path],
  );
  if (normalized === null) {
    return (
      <pre
        className={cn(
          "overflow-x-auto px-3 py-2 font-mono text-xs leading-5 text-foreground/80",
          className,
        )}
      >
        {patch}
      </pre>
    );
  }
  return (
    <DiffHost
      file={normalized.file}
      patchText={normalized.patch}
      fullFileContents={fullFileContents ?? null}
      view={view}
      overflow={overflow}
      showLineNumbers={showLineNumbers}
      className={className}
    />
  );
}
