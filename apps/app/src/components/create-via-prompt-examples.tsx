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
import { CREATE_PLUGIN_PROMPT, CREATE_SKILL_PROMPT } from "@bb/client-core";

type CreateViaPromptKind = "skill" | "plugin";

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
  examples: readonly Example[];
}

// The description completes the prompt prefix, so each card both teaches and
// seeds the composer. Skills are standard Agent Skills whose bb edge is being
// cross-provider; automations run scripts and can escalate to threads.
const CONFIG: Record<CreateViaPromptKind, KindConfig> = {
  skill: {
    prefix: CREATE_SKILL_PROMPT,
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
};

interface CreateExample {
  label: string;
  icon: IconName;
  description: string;
  /** Full composer prompt seeded when this example is picked. */
  prompt: string;
}

/**
 * The shared create-via-prompt content for a kind: the examples with their
 * full seeded prompts. Surfaces render it how they like (cards, chips) without
 * duplicating the copy.
 */
export function getCreateExamples(kind: CreateViaPromptKind): {
  examples: CreateExample[];
} {
  const config = CONFIG[kind];
  return {
    examples: config.examples.map((example) => ({
      label: example.label,
      icon: example.icon,
      description: example.description,
      prompt: example.prompt ?? `${config.prefix}${example.description}.`,
    })),
  };
}

interface CreateWithTemplatesButtonProps {
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
