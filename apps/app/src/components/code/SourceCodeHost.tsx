import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { defineSplit } from "@/lib/define-split";
import { SourceLoadingSkeleton } from "./code-loading-skeletons";
import { useSourceCodeRendererReplacement } from "./codeRendererProvider";
import {
  DEFAULT_CODE_OVERFLOW,
  type BbSourceCodeProps,
} from "./code-rendering";

const SOURCE_CODE_RENDERER_SLOT_KIND = "sourceCodeRenderer";

export const BbSourceCodeSplit = defineSplit<BbSourceCodeProps>({
  id: "bb-source-code",
  load: () => import("./BbSourceCode").then((module) => module.default),
  loading: () => <SourceLoadingSkeleton />,
  tier: "intent",
});

interface SourceCodeHostProps extends Omit<
  BbSourceCodeProps,
  "overflow" | "highlightedLines"
> {
  overflow?: BbSourceCodeProps["overflow"];
  highlightedLines?: BbSourceCodeProps["highlightedLines"];
}

export function SourceCodeHost({
  content,
  path,
  cacheKey,
  overflow = DEFAULT_CODE_OVERFLOW,
  highlightedLines = null,
  className,
  scrollToHighlightedLines,
  onSelectionAddToChat,
}: SourceCodeHostProps) {
  const replacement = useSourceCodeRendererReplacement();

  const original = (
    <BbSourceCodeSplit
      content={content}
      path={path}
      cacheKey={cacheKey}
      overflow={overflow}
      highlightedLines={highlightedLines}
      className={className}
      scrollToHighlightedLines={scrollToHighlightedLines}
      onSelectionAddToChat={onSelectionAddToChat}
    />
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
            Original={BoundOriginal}
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}
