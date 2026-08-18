import type {
  EditableSkillScope,
  SkillScope,
  SkillSummary,
} from "@bb/server-contract";
import { getProviderIconInfo } from "@/lib/provider-icon";

const SKILL_ROOT_LABELS: Record<
  Exclude<SkillScope, "provider-user" | "provider-project">,
  string
> = {
  "bb-builtin": "Built-in",
  "bb-user": "bb · user",
  "bb-project": "bb · project",
  "shared-user": "Shared · user",
  "shared-project": "Shared · project",
  plugin: "Plugin",
};

/**
 * Provider scopes are labelled from the skill's own `provider` field rather
 * than from the scope, which used to spell the provider out (`claude-user`,
 * `codex-project`, …) and therefore could not name a plugin provider at all.
 */
export function skillScopeLabel(
  skill: Pick<SkillSummary, "scope" | "provider">,
  /**
   * The provider's display name from the server roster. Without it the label
   * falls back to the icon's per-tier aria label, which every unknown `acp-*`
   * agent shares ("ACP provider").
   */
  providerDisplayName?: string,
): string {
  if (skill.scope === "provider-user" || skill.scope === "provider-project") {
    const root = skill.scope === "provider-user" ? "user" : "project";
    const provider = skill.provider;
    const providerLabel =
      providerDisplayName ??
      (provider === null
        ? "Provider"
        : (getProviderIconInfo(provider)?.ariaLabel ?? provider));
    return `${providerLabel} · ${root}`;
  }
  return SKILL_ROOT_LABELS[skill.scope];
}

export function isSkillEditable(
  skill: SkillSummary,
): skill is SkillSummary & { scope: EditableSkillScope } {
  switch (skill.scope) {
    case "bb-user":
    case "bb-project":
      return true;
    case "provider-user":
    case "provider-project":
      return skill.manageable;
    case "shared-user":
    case "shared-project":
    case "bb-builtin":
    case "plugin":
      return false;
  }
}
