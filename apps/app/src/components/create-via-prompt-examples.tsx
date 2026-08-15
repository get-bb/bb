import {
  ResourceCreateButton,
  type ResourceCreateMenuAction,
  type ResourceCreateTemplateGroup,
} from "@bb/shared-ui/resource-list";
import type { IconName } from "@bb/shared-ui/icon";
import {
  BROWSE_ARCHETYPES,
  UTILITY_EXAMPLES,
  archetypePrompt,
  utilityPrompt,
} from "@/components/plugin/browse-hero/browse-hero-archetypes";
import {
  CREATE_AUTOMATION_PROMPT,
  CREATE_PLUGIN_PROMPT,
  CREATE_SKILL_PROMPT,
} from "@/lib/create-resource-prompts";

export type CreateViaPromptKind = "skill" | "plugin" | "automation";

interface Example {
  label: string;
  icon: IconName;
  /** Completes the "Create a new bb {kind} …" prompt; also shown on the card. */
  description: string;
  /** Full prompt override when the description alone is not the brief. */
  prompt?: string;
}

interface KindConfig {
  prefix: string;
  explainer: string;
  examples: readonly Example[];
}

// The description completes the prompt prefix, so each card both teaches and
// seeds the composer. Skills are standard Agent Skills whose bb edge is being
// cross-provider; automations run scripts and can escalate to threads.
const CONFIG: Record<CreateViaPromptKind, KindConfig> = {
  skill: {
    prefix: CREATE_SKILL_PROMPT,
    explainer:
      "Write a skill once, and every agent in bb can run it, whatever the provider.",
    examples: [
      {
        label: "PR review",
        icon: "GitPullRequest",
        description:
          "reviews a GitHub PR, checks changed files, runs focused tests, and returns blocking findings first",
      },
      {
        label: "Release notes",
        icon: "FileText",
        description:
          "turns merged PRs into concise customer-facing release notes with links and risk notes",
      },
      {
        label: "Incident debug",
        icon: "Bug",
        description:
          "collects logs, recent deploys, and failing checks before proposing the smallest fix",
      },
    ],
  },
  plugin: {
    prefix: CREATE_PLUGIN_PROMPT,
    explainer:
      "Add app surfaces, commands, background work, or agent tools through a plugin.",
    // The Browse hero's use-case archetypes verbatim, so the New plugin menu
    // and the Browse page can never show two divergent example lists. The
    // one-line hook is the card text; the full brief rides in `prompt`.
    examples: BROWSE_ARCHETYPES.map((archetype) => ({
      label: archetype.title,
      icon: archetype.icon,
      description: archetype.hook,
      prompt: archetypePrompt(archetype),
    })),
  },
  automation: {
    prefix: CREATE_AUTOMATION_PROMPT,
    explainer:
      "Run scripts on a schedule and spawn agent threads only when there is real work.",
    examples: [
      {
        label: "CI failure triage",
        icon: "AlertCircle",
        description:
          "runs every weekday morning, checks failed main-branch CI, and opens fixer threads only for new failures",
      },
      {
        label: "Dependency drift",
        icon: "ElectricPlugs",
        description:
          "checks weekly for stale dependencies and opens an update thread when risk is low",
      },
      {
        label: "Release readiness",
        icon: "Target",
        description:
          "checks the release branch hourly, summarizes blocking checks, and alerts only when the status changes",
      },
      {
        label: "Stale worktrees",
        icon: "FolderGit",
        description:
          "checks daily for stale worktrees and opens cleanup threads only after they exceed the team's retention window",
      },
    ],
  },
};

export interface CreateExample {
  label: string;
  icon: IconName;
  description: string;
  /** Full composer prompt seeded when this example is picked. */
  prompt: string;
}

/**
 * The shared create-via-prompt content for a kind: the marketing one-liner and
 * the examples with their full seeded prompts. Surfaces render it how they like
 * (cards, chips) without duplicating the copy.
 */
export function getCreateExamples(kind: CreateViaPromptKind): {
  explainer: string;
  examples: CreateExample[];
} {
  const config = CONFIG[kind];
  return {
    explainer: config.explainer,
    examples: config.examples.map((example) => ({
      label: example.label,
      icon: example.icon,
      description: example.description,
      prompt: example.prompt ?? `${config.prefix}${example.description}.`,
    })),
  };
}

export interface CreateWithTemplatesButtonProps {
  kind: CreateViaPromptKind;
  /** Main-button text, e.g. "New automation" or "New bb skill". */
  label: string;
  menuActions?: readonly ResourceCreateMenuAction[];
  /** Blank when called with no argument; seeded when given an example prompt. */
  onCreate: (prompt?: string) => void;
}

/**
 * Split (combo) button: the left half opens the composer with the kind's base
 * prompt; the right half opens examples that seed a more specific prompt.
 * Shared by the resource library toolbars.
 */
export function CreateWithTemplatesButton({
  kind,
  label,
  menuActions,
  onCreate,
}: CreateWithTemplatesButtonProps) {
  const { examples } = getCreateExamples(kind);
  // Plugins carry a second tier: the per-capability briefs the Browse page
  // shows under "Explore plugin capabilities". The menu mirrors both tiers so
  // it never under-promises what the examples surface offers.
  const templateGroups: readonly ResourceCreateTemplateGroup[] | undefined =
    kind === "plugin"
      ? [
          { label: "Examples", templates: examples },
          {
            label: "Capabilities",
            templates: UTILITY_EXAMPLES.map((example) => ({
              label: example.label,
              icon: example.icon,
              description: example.brief,
              prompt: utilityPrompt(example),
            })),
          },
        ]
      : undefined;
  return (
    <ResourceCreateButton
      label={label}
      templates={examples}
      templateGroups={templateGroups}
      menuActions={menuActions}
      onCreate={onCreate}
    />
  );
}
