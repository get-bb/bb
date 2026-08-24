import type { PromptMentionResource } from "@bb/domain";
import type { IconName } from "@/ui/icon-map";

/**
 * Pill presentation for prompt mentions; mirrors
 * `apps/app/src/components/promptbox/mentions/prompt-mention-display.ts`.
 */

export function promptMentionIconName(
  resource: PromptMentionResource,
): IconName {
  switch (resource.kind) {
    case "thread":
      return "UserRound";
    case "project":
      return "Folder";
    case "section":
      return "SectionAdd";
    case "command":
      if (resource.source === "skill") return "Zap";
      if (resource.name === "plan") return "ListTodo";
      if (resource.name === "goal") return "Target";
      return "Terminal";
    case "plugin":
      return "Zap";
    case "path":
      return resource.entryKind === "directory" ? "Folder" : "File";
  }
}

function promptMentionKindLabel(resource: PromptMentionResource): string {
  switch (resource.kind) {
    case "thread":
      return "Thread";
    case "project":
      return "Project";
    case "section":
      return "Section";
    case "command":
      return resource.source === "skill" ? "Skill" : "Command";
    case "plugin":
      return "Plugin";
    case "path":
      if (resource.source === "thread-storage") return "Storage";
      return resource.entryKind === "directory" ? "Folder" : "File";
  }
}

/** Accessibility label / long-press detail for a mention pill. */
export function promptMentionAccessibilityLabel(
  resource: PromptMentionResource,
): string {
  if (resource.kind === "path") {
    return resource.source === "thread-storage"
      ? `thread-storage:${resource.path}`
      : resource.path;
  }
  if (resource.kind === "command") {
    return `${resource.trigger}${resource.name}${
      resource.argumentHint ? ` ${resource.argumentHint}` : ""
    }`;
  }
  return `${promptMentionKindLabel(resource)}: ${resource.label}`;
}
