import type { PromptMentionResource } from "@bb/domain";
import type { IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// Keeps prompt mention pills aligned with surrounding text. The icon in React
// render paths opts back into vertical centering with `self-center`.
export const PROMPT_MENTION_PILL_CLASS = cn(
  "inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-surface-selected-border px-1.5 py-0.5 text-xs leading-4 text-foreground",
  "align-baseline",
);

export function promptMentionIconLabel(
  resource: PromptMentionResource,
): string {
  if (resource.kind === "thread") {
    return "Thread";
  }
  if (resource.source === "thread-storage") {
    return "Storage";
  }
  return resource.entryKind === "directory" ? "Folder" : "File";
}

/**
 * Leading icon for a mention, shared by the suggestion menu rows and the
 * inserted pills so the two surfaces stay visually in lock-step.
 */
export function promptMentionIconName(
  resource: PromptMentionResource,
): IconName {
  if (resource.kind === "thread") {
    return "MessageSquare";
  }
  return resource.entryKind === "directory" ? "Folder" : "File";
}

export function promptMentionDisplayLabel(
  resource: PromptMentionResource,
): string {
  return `${promptMentionIconLabel(resource)}: ${resource.label}`;
}

export function promptMentionTooltipLabel(
  resource: PromptMentionResource,
): string {
  if (resource.kind === "path") {
    return resource.source === "thread-storage"
      ? `thread-storage:${resource.path}`
      : resource.path;
  }

  return promptMentionDisplayLabel(resource);
}
