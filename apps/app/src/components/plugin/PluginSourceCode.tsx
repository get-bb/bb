import type { SourceCodeProps } from "@get-bb/plugin-sdk";
import { BbSourceCodeSplit } from "@/components/code/BbSourceCodeSplit";
import { DEFAULT_CODE_OVERFLOW } from "@/components/code/code-rendering";
import { useSelectionAddToChat } from "@/components/thread/SelectionAddToChatContext";

export function PluginSourceCode({
  content,
  path,
  overflow = DEFAULT_CODE_OVERFLOW,
  highlightedLines,
  className,
}: SourceCodeProps) {
  const onSelectionAddToChat = useSelectionAddToChat();
  return (
    <BbSourceCodeSplit
      content={content}
      path={path}
      overflow={overflow}
      highlightedLines={highlightedLines ?? null}
      className={className}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}
