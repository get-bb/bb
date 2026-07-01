import type { PromptMentionResource } from "@bb/domain";
import type { IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type PromptCommandLike = Pick<
  Extract<PromptMentionResource, { kind: "command" }>,
  "name" | "source"
>;

// Keeps prompt mention pills aligned with surrounding text. The icon in React
// render paths opts back into vertical centering with `self-center`. The
// theme-specific surface, label color, and icon color all come from the
// `prompt-mention-pill` component class in app.css; this string owns layout,
// radius, border width, and type scale only.
export const PROMPT_MENTION_PILL_CLASS = cn(
  "prompt-mention-pill inline-flex max-w-full items-baseline gap-0.5 rounded-full border py-0.5 pl-1 pr-1.5 text-xs leading-4",
  "align-baseline",
);

export function promptMentionIconLabel(
  resource: PromptMentionResource,
): string {
  if (resource.kind === "thread") {
    return "Thread";
  }
  if (resource.kind === "project") {
    return "Project";
  }
  if (resource.kind === "command") {
    return resource.source === "skill" ? "Skill" : "Command";
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
  if (resource.kind === "project") {
    return "FolderGit";
  }
  if (resource.kind === "command") {
    return promptCommandIconName(resource);
  }
  return resource.entryKind === "directory" ? "Folder" : "File";
}

export function promptCommandIconName(command: PromptCommandLike): IconName {
  if (command.source === "skill") {
    return "Zap";
  }
  if (command.name === "plan") {
    return "ListTodo";
  }
  if (command.name === "goal") {
    return "Target";
  }
  if (command.name === "loop") {
    return "Repeat";
  }
  return "Terminal";
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
  if (resource.kind === "command") {
    return `${resource.trigger}${resource.name}${resource.argumentHint ? ` ${resource.argumentHint}` : ""}`;
  }

  return promptMentionDisplayLabel(resource);
}
