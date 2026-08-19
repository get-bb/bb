import type { SourceCodeProps } from "@get-bb/plugin-sdk";
import { SourceCodeHost } from "@/components/code/SourceCodeHost";

/**
 * The public `experimental_SourceCode` component. It is the host boundary with
 * the host-only inputs withheld: a plugin supplies text and presentation, and
 * BB owns highlighting, gutters, the live code theme, and any active
 * `experimental_sourceCodeRenderer` replacement.
 */
export function PluginSourceCode({
  content,
  path,
  overflow,
  highlightedLines,
  className,
}: SourceCodeProps) {
  return (
    <SourceCodeHost
      content={content}
      path={path}
      overflow={overflow}
      highlightedLines={highlightedLines ?? null}
      className={className}
    />
  );
}
