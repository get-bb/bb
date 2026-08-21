import { Suspense, lazy, type ReactNode } from "react";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { useSourceCodeRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  type BbSourceCodeProps,
} from "./code-rendering";

/** Shared by the mount and the host's crash check. */
const SOURCE_CODE_RENDERER_SLOT_KIND = "sourceCodeRenderer";

const BbSourceCode = lazy(() => import("./BbSourceCode"));

interface SourceCodeHostProps extends Omit<
  BbSourceCodeProps,
  "overflow" | "highlightedLines"
> {
  overflow?: BbSourceCodeProps["overflow"];
  highlightedLines?: BbSourceCodeProps["highlightedLines"];
  /** Rendered while BB's renderer chunk loads. */
  fallback?: ReactNode;
}

/**
 * The host boundary for source rendering (plugin design: exclusive replacement
 * surfaces). BB's native file preview and every plugin that calls
 * `experimental_SourceCode` render through here, so one
 * `experimental_sourceCodeRenderer` registration replaces them all at once.
 *
 * BB's own renderer sits behind `lazy()`; a replacement that never delegates
 * never downloads it.
 */
export function SourceCodeHost({
  content,
  path,
  cacheKey,
  overflow = DEFAULT_CODE_OVERFLOW,
  highlightedLines = null,
  className,
  fallback = null,
  scrollToHighlightedLines,
  onSelectionAddToChat,
}: SourceCodeHostProps) {
  const replacement = useSourceCodeRendererReplacement();

  const original = (
    <Suspense fallback={fallback}>
      <BbSourceCode
        content={content}
        path={path}
        cacheKey={cacheKey}
        overflow={overflow}
        highlightedLines={highlightedLines}
        className={className}
        scrollToHighlightedLines={scrollToHighlightedLines}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </Suspense>
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={SOURCE_CODE_RENDERER_SLOT_KIND}
    >
      {(slot, BoundOriginal) => (
        <div className={className}>
          <slot.component
            content={content}
            path={path}
            overflow={overflow}
            highlightedLines={highlightedLines}
            experimental_Original={BoundOriginal}
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}
