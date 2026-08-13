import {
  ResourceCreateButton,
  type ResourceCreateMenuAction,
} from "@bb/shared-ui/resource-list";
import type { IconName } from "@bb/shared-ui/icon";
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
    examples: [
      {
        label: "GitHub triage",
        icon: "Github",
        description:
          "adds a GitHub panel that lists assigned PRs and lets agents open review threads",
      },
      {
        label: "Slack notifier",
        icon: "Sent",
        description:
          "adds a background service that posts thread failures to a configured Slack webhook",
      },
      {
        label: "Project commands",
        icon: "Terminal",
        description:
          "adds bb CLI commands for the team's deploy and rollback workflow",
      },
      {
        label: "Issue mentions",
        icon: "MessageSquarePlus",
        description:
          "connects Linear issues to the prompt box with searchable mentions and agent-ready context",
      },
    ],
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
      prompt: `${config.prefix}${example.description}.`,
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
  return (
    <ResourceCreateButton
      label={label}
      templates={examples}
      menuActions={menuActions}
      onCreate={onCreate}
    />
  );
}
