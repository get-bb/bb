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

export interface SkillScopeDefinition {
  label: string;
  ownership: SkillScopeOwnership;
  editability: "always" | "when-manageable" | "never";
}

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

/** Canonical ownership/editability taxonomy for every server skill scope. */
export const SKILL_SCOPE_DEFINITIONS: Record<SkillScope, SkillScopeDefinition> =
  {
    "bb-builtin": {
      label: SKILL_SCOPE_LABELS["bb-builtin"],
      ownership: "built-in",
      editability: "never",
    },
    "bb-user": {
      label: SKILL_SCOPE_LABELS["bb-user"],
      ownership: "user",
      editability: "always",
    },
    "bb-project": {
      label: SKILL_SCOPE_LABELS["bb-project"],
      ownership: "project",
      editability: "always",
    },
    "claude-user": {
      label: SKILL_SCOPE_LABELS["claude-user"],
      ownership: "imported",
      editability: "when-manageable",
    },
    "claude-project": {
      label: SKILL_SCOPE_LABELS["claude-project"],
      ownership: "imported",
      editability: "when-manageable",
    },
    "codex-user": {
      label: SKILL_SCOPE_LABELS["codex-user"],
      ownership: "imported",
      editability: "when-manageable",
    },
    "codex-project": {
      label: SKILL_SCOPE_LABELS["codex-project"],
      ownership: "imported",
      editability: "when-manageable",
    },
    plugin: {
      label: SKILL_SCOPE_LABELS.plugin,
      ownership: "bundled",
      editability: "never",
    },
  };

export function isKnownSkillScope(
  value: string | undefined,
): value is SkillScope {
  return value !== undefined && value in SKILL_SCOPE_DEFINITIONS;
}

export function isSkillEditable(
  skill: SkillSummary,
): skill is SkillSummary & { scope: EditableSkillScope } {
  const editability = SKILL_SCOPE_DEFINITIONS[skill.scope].editability;
  return (
    editability === "always" ||
    (editability === "when-manageable" && skill.manageable)
  );
}
