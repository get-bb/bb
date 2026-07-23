import type {
  EditableSkillScope,
  SkillScope,
  SkillSummary,
} from "@bb/server-contract";

export type SkillScopeOwnership =
  | "built-in"
  | "user"
  | "project"
  | "imported"
  | "bundled";

export const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  "bb-builtin": "Built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "claude-user": "Claude · user",
  "claude-project": "Claude · project",
  "codex-user": "Codex · user",
  "codex-project": "Codex · project",
  plugin: "Plugin",
};

export const SKILL_SCOPE_OWNERSHIP: Record<SkillScope, SkillScopeOwnership> = {
  "bb-builtin": "built-in",
  "bb-user": "user",
  "bb-project": "project",
  "claude-user": "imported",
  "claude-project": "imported",
  "codex-user": "imported",
  "codex-project": "imported",
  plugin: "bundled",
};

export function isKnownSkillScope(
  value: string | undefined,
): value is SkillScope {
  return value !== undefined && value in SKILL_SCOPE_LABELS;
}

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
      return skill.manageable;
    case "bb-builtin":
    case "plugin":
      return false;
  }
}
