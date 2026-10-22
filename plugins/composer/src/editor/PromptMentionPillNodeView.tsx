import { useContext, type KeyboardEvent, type MouseEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  experimental_describePromptMention as describePromptMention,
  experimental_promptMentionClipboardAttributes as promptMentionClipboardAttributes,
  experimental_PromptMentionIcon as PromptMentionIcon,
  experimental_useThreadTitleDisplayText as useThreadTitleDisplayText,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { PromptMentionLinkContext } from "./prompt-mention-link";
import { parsePromptEditorMentionAttrs } from "./prompt-editor-serialization";

const EDITOR_MENTION_PILL_CLASS =
  "group selection:bg-transparent [&_*]:selection:bg-transparent";

export function PromptMentionPillNodeView({
  node,
  decorations,
}: NodeViewProps) {
  const resolveLink = useContext(PromptMentionLinkContext);
  const attrs = parsePromptEditorMentionAttrs(node.attrs);
  const threadDisplayLabel = useThreadTitleDisplayText(
    attrs?.mention.kind === "thread" ? attrs.mention.label : "",
  );
  const fallbackSerializedText =
    typeof node.attrs.serializedText === "string"
      ? node.attrs.serializedText
      : undefined;
  const isSelected = decorations.some(
    (decoration) => decoration.spec?.mentionSelected === true,
  );
  const selectedClass = isSelected ? "prompt-mention-pill--selected" : null;

  if (!attrs) {
    return (
      <NodeViewWrapper
        as="span"
        className={cn(EDITOR_MENTION_PILL_CLASS, selectedClass)}
        data-prompt-mention="true"
      >
        {fallbackSerializedText ?? "@mention"}
      </NodeViewWrapper>
    );
  }

  const mention =
    attrs.mention.kind === "thread" &&
    attrs.mention.label !== threadDisplayLabel
      ? { ...attrs.mention, label: threadDisplayLabel }
      : attrs.mention;
  const activate = resolveLink?.(mention) ?? null;
  const presentation = describePromptMention(mention);
  const title = presentation.title;
  const activationLabel = activate ? `Open ${title}` : undefined;
  const handleClick = activate
    ? (event: MouseEvent<HTMLElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey
        ) {
          return;
        }
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        activate();
      }
    : undefined;
  const handleKeyDown = activate
    ? (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        activate();
      }
    : undefined;

  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        EDITOR_MENTION_PILL_CLASS,
        presentation.className,
        selectedClass,
        activate && "cursor-pointer",
      )}
      {...promptMentionClipboardAttributes(attrs.mention, attrs.serializedText)}
      role={activate ? "button" : undefined}
      tabIndex={activate ? 0 : undefined}
      aria-label={activationLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <PromptMentionIcon
        mention={mention}
        className="-ml-px size-4 shrink-0 self-center"
      />
      <span className={cn("truncate", activate && "group-hover:underline")}>
        {mention.label}
      </span>
    </NodeViewWrapper>
  );
}
