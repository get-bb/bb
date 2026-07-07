import { useContext, type KeyboardEvent, type MouseEvent } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionIconName,
  promptMentionTooltipLabel,
} from "@/components/promptbox/mentions/prompt-mention-display";
import { promptMentionClipboardDataAttributes } from "@/components/promptbox/mentions/prompt-mention-clipboard";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PromptMentionLinkContext } from "./prompt-mention-link";
import { parsePromptEditorMentionAttrs } from "./prompt-editor-serialization";

// The `selection:` utilities suppress the native `::selection` paint inside the
// pill — it can't cover the SVG icon, so the pill paints its own selected
// background instead. `group` lets an openable pill underline its label on
// hover, link-style.
const EDITOR_MENTION_PILL_CLASS = cn(
  "group",
  PROMPT_MENTION_PILL_CLASS,
  "selection:bg-transparent [&_*]:selection:bg-transparent",
);

/**
 * Renders an inserted prompt mention as a pill with a leading type icon (file,
 * folder or thread) matching the suggestion menu rows. A Tiptap React
 * node view is used instead of `renderHTML` so the pill can mount the shared
 * `Icon` component; `renderHTML` remains the serialization fallback.
 *
 * When the surrounding composer supplies a `PromptMentionLinkResolver`, an
 * openable pill behaves like a link: its label underlines on hover and a plain
 * click opens the file/thread.
 */
export function PromptMentionPillNodeView({
  node,
  decorations,
}: NodeViewProps) {
  const resolveLink = useContext(PromptMentionLinkContext);
  const attrs = parsePromptEditorMentionAttrs(node.attrs);
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

  const resource = attrs.resource;
  const activate = resolveLink?.(resource) ?? null;
  const title = promptMentionTooltipLabel(resource);
  const activationLabel = activate ? `Open ${title}` : undefined;
  const handleClick = activate
    ? (event: MouseEvent<HTMLElement>) => {
        // Plain primary click only — leave modifier clicks and drag-selection
        // releases to the editor's normal selection handling.
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
        selectedClass,
        activate && "cursor-pointer",
      )}
      {...promptMentionClipboardDataAttributes(attrs)}
      role={activate ? "button" : undefined}
      tabIndex={activate ? 0 : undefined}
      aria-label={activationLabel}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Icon
        name={promptMentionIconName(resource)}
        className="-ml-px size-4 shrink-0 self-center"
        aria-hidden
      />
      <span className={cn("truncate", activate && "group-hover:underline")}>
        {resource.label}
      </span>
    </NodeViewWrapper>
  );
}
