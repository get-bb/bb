import type {
  EditableSkillScope,
  SkillScope,
  SkillSummary,
} from "@bb/server-contract";

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  "bb-builtin": "Built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "claude-user": "Claude · user",
  "claude-project": "Claude · project",
  "codex-user": "Codex · user",
  "codex-project": "Codex · project",
  "cursor-user": "Cursor · user",
  "cursor-project": "Cursor · project",
  "shared-user": "Shared · user",
  "shared-project": "Shared · project",
  plugin: "Plugin",
};

export function isSkillEditable(
  skill: SkillSummary,
): skill is SkillSummary & { scope: EditableSkillScope } {
  switch (skill.scope) {
    case "bb-user":
    case "bb-project":
      return true;
    case "claude-user":
    case "claude-project":
    case "codex-user":
    case "codex-project":
    case "cursor-user":
    case "cursor-project":
      return skill.manageable;
    case "shared-user":
    case "shared-project":
    case "bb-builtin":
    case "plugin":
      return false;
  }
}
