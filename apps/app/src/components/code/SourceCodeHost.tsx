import { Suspense, lazy, useCallback, useRef, type ReactNode } from "react";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { useSourceCodeRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  type BbSourceCodeProps,
} from "./code-rendering";
import { registerSelectAllCopyText } from "@/lib/select-all-scope";
import { cn } from "@bb/shared-ui/lib/utils";

/** Shared by the mount and the host's crash check. */
export const SOURCE_CODE_RENDERER_SLOT_KIND = "sourceCodeRenderer";

const BbSourceCode = lazy(() => import("./BbSourceCode"));

export interface SourceCodeHostProps extends Omit<
  BbSourceCodeProps,
  "overflow" | "highlightedLines"
> {
  overflow?: BbSourceCodeProps["overflow"];
  highlightedLines?: BbSourceCodeProps["highlightedLines"];
  /** Rendered while BB's renderer chunk loads. */
  fallback?: ReactNode;
}

function PluginSourceCodeSelectionScope({
  children,
  className,
  content,
}: {
  children: ReactNode;
  className?: string;
  content: string;
}) {
  const unregisterRef = useRef<(() => void) | null>(null);
  const setScopeRef = useCallback(
    (scope: HTMLDivElement | null) => {
      unregisterRef.current?.();
      unregisterRef.current =
        scope === null ? null : registerSelectAllCopyText(scope, () => content);
    },
    [content],
  );
  return (
    <div
      ref={setScopeRef}
      className={cn("select-text", className)}
      data-select-all-scope=""
    >
      {children}
    </div>
  );
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
        <PluginSourceCodeSelectionScope className={className} content={content}>
          <slot.component
            content={content}
            path={path}
            overflow={overflow}
            highlightedLines={highlightedLines}
            experimental_Original={BoundOriginal}
          />
        </PluginSourceCodeSelectionScope>
      )}
    </PluginReplacementSlot>
  );
}
