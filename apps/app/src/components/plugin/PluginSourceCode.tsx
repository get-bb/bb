import type { SourceCodeProps } from "@get-bb/plugin-sdk";
import { SourceCodeHost } from "@/components/code/SourceCodeHost";
import { useSelectionAddToChat } from "@/components/thread/SelectionAddToChatContext";

export function PluginSourceCode({
  content,
  path,
  overflow,
  highlightedLines,
  className,
}: SourceCodeProps) {
  const onSelectionAddToChat = useSelectionAddToChat();
  return (
    <SourceCodeHost
      content={content}
      path={path}
      overflow={overflow}
      highlightedLines={highlightedLines ?? null}
      className={className}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}
