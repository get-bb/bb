import { useAtom, type WritableAtom } from "jotai";
import type { SetStateAction } from "react";
import {
  diffRendererProviderAtom,
  sourceCodeRendererProviderAtom,
} from "@/components/code/codeRendererProvider";
import { threadHeaderTitleProviderAtom } from "@/components/plugin/PluginThreadHeaderTitle";
import { threadRailOutlineProviderAtom } from "@/components/plugin/thread-rail-outline-pick";
import { composerRendererProviderAtom } from "@/components/promptbox/composer-provider";
import { sidebarNavigationProviderAtom } from "@/components/sidebar/sidebarNavigationProvider";
import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { SettingsSection } from "@bb/shared-ui/settings-section";
import { fileOpenerPreferenceAtom } from "@/lib/file-opener-preference";
import {
  codeFencePicksAtom,
  messageDirectivePicksAtom,
  MARKDOWN_SETTINGS_TITLE,
  FILE_OPENERS_TITLE,
} from "@/lib/plugin-choice-picks";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  NO_AUTOMATIC_RULE,
  PLUGIN_ONLY_RULE,
  replacementProviderKey,
  REPLACEMENT_RULE,
  type ExclusiveRule,
} from "@/lib/plugin-replacement-preference";
import { getPluginDisplayName } from "@/lib/plugin-logos";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import {
  ReplacementProviderSetting,
  type BuiltInChoice,
} from "./ReplacementProviderSetting";

interface ChoiceClaimant {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
}

type StringPickAtom = WritableAtom<string, [SetStateAction<string>], void>;
type PickMapAtom = WritableAtom<
  Readonly<Record<string, string>>,
  [SetStateAction<Readonly<Record<string, string>>>],
  void
>;

interface SlotChoice {
  kind: "slot";
  label: string;
  description: string;
  claimants: readonly ChoiceClaimant[];
  atom: StringPickAtom;
  rule: ExclusiveRule;
  builtIn: BuiltInChoice | null;
}

interface KeyedChoice {
  kind: "keyed";
  noun: (keys: readonly string[]) => string;
  description: string | null;
  claimantsByKey: ReadonlyMap<string, readonly ChoiceClaimant[]>;
  atom: PickMapAtom;
  rule: ExclusiveRule;
  builtIn: BuiltInChoice | null;
}

const BB_BUILT_IN = "bb (built-in)";

function groupByKey<Registration extends { pluginId: string; id: string }>(
  registrations: readonly Registration[],
  keysOf: (registration: Registration) => readonly string[],
  titleOf: (registration: Registration, key: string) => ChoiceClaimant,
): ReadonlyMap<string, readonly ChoiceClaimant[]> {
  const grouped = new Map<string, ChoiceClaimant[]>();
  for (const registration of registrations) {
    for (const key of keysOf(registration)) {
      const claimants = grouped.get(key) ?? [];
      claimants.push(titleOf(registration, key));
      grouped.set(key, claimants);
    }
  }
  return grouped;
}

export interface PluginChoices {
  slots: readonly SlotChoice[];
  fileOpeners: KeyedChoice;
  codeFences: KeyedChoice;
  directives: KeyedChoice;
}

export function usePluginChoices(): PluginChoices {
  const navigations = usePluginSlotKind("experimentalSidebarNavigations");
  const threadLists = usePluginSlotKind("threadLists");
  const composers = usePluginSlotKind("composers");
  const diffRenderers = usePluginSlotKind("diffRenderers");
  const sourceCodeRenderers = usePluginSlotKind("sourceCodeRenderers");
  const threadHeaderTitles = usePluginSlotKind("threadHeaderTitles");
  const threadRailOutlines = usePluginSlotKind("threadRailOutlines");
  const fileOpenerSlots = usePluginSlotKind("fileOpeners");
  const codeFenceRenderers = usePluginSlotKind("codeFenceRenderers");
  const messageDirectives = usePluginSlotKind("messageDirectives");

  const slots: SlotChoice[] = [
    {
      kind: "slot",
      label: "Navigation",
      description:
        "What draws New thread, Plugins, Skills, and plugin pages in the sidebar.",
      claimants: navigations,
      atom: sidebarNavigationProviderAtom,
      rule: PLUGIN_ONLY_RULE,
      builtIn: null,
    },
    {
      kind: "slot",
      label: "Sidebar thread list",
      description: "Which plugin draws your threads in the sidebar.",
      claimants: threadLists,
      atom: threadListProviderAtom,
      rule: PLUGIN_ONLY_RULE,
      builtIn: null,
    },
    {
      kind: "slot",
      label: "Source code",
      description: "Source files in the file preview and plugin views.",
      claimants: sourceCodeRenderers,
      atom: sourceCodeRendererProviderAtom,
      rule: REPLACEMENT_RULE,
      builtIn: {
        title: BB_BUILT_IN,
        description: "Syntax highlighting and gutters from the bb code theme.",
      },
    },
    {
      kind: "slot",
      label: "Diffs",
      description: "File diffs in threads, the diff panel, and plugin views.",
      claimants: diffRenderers,
      atom: diffRendererProviderAtom,
      rule: REPLACEMENT_RULE,
      builtIn: {
        title: BB_BUILT_IN,
        description: "Unified and split diffs from the bb code theme.",
      },
    },
    {
      kind: "slot",
      label: "Composer",
      description:
        "The prompt box in threads, the New thread screen, and message editors.",
      claimants: composers,
      atom: composerRendererProviderAtom,
      rule: PLUGIN_ONLY_RULE,
      builtIn: null,
    },
    {
      kind: "slot",
      label: "Thread header title",
      description: "The thread title at the top of a thread.",
      claimants: threadHeaderTitles.map((slot) => ({
        pluginId: slot.pluginId,
        id: slot.id,
        title: getPluginDisplayName(slot.pluginId),
      })),
      atom: threadHeaderTitleProviderAtom,
      rule: REPLACEMENT_RULE,
      builtIn: {
        title: BB_BUILT_IN,
        description: "The thread's name, renamed in place.",
      },
    },
    {
      kind: "slot",
      label: "Thread outline",
      description: "The outline of your messages beside a thread.",
      claimants: threadRailOutlines.map((slot) => ({
        pluginId: slot.pluginId,
        id: slot.id,
        title: getPluginDisplayName(slot.pluginId),
      })),
      atom: threadRailOutlineProviderAtom,
      rule: REPLACEMENT_RULE,
      builtIn: {
        title: BB_BUILT_IN,
        description: "A rail of your messages that jumps to each one.",
      },
    },
  ];

  const fileOpeners: KeyedChoice = {
    kind: "keyed",
    noun: (keys) => `${keys.map((key) => `.${key}`).join(", ")} files`,
    description: null,
    claimantsByKey: groupByKey(
      fileOpenerSlots,
      (opener) => opener.extensions,
      (opener) => opener,
    ),
    atom: fileOpenerPreferenceAtom,
    rule: REPLACEMENT_RULE,
    builtIn: { title: "Built-in preview", description: "bb's file preview." },
  };
  const codeFences: KeyedChoice = {
    kind: "keyed",
    noun: (keys) => `${keys.join(", ")} code blocks`,
    description: null,
    claimantsByKey: groupByKey(
      codeFenceRenderers,
      (renderer) => renderer.languages,
      (renderer) => ({
        pluginId: renderer.pluginId,
        id: renderer.id,
        title: getPluginDisplayName(renderer.pluginId),
      }),
    ),
    atom: codeFencePicksAtom,
    rule: REPLACEMENT_RULE,
    builtIn: { title: BB_BUILT_IN, description: "bb's code block." },
  };
  const directives: KeyedChoice = {
    kind: "keyed",
    noun: (keys) => `${keys.map((key) => `::${key}`).join(", ")} directives`,
    description: null,
    claimantsByKey: groupByKey(
      messageDirectives,
      (directive) => [directive.id],
      (directive) => ({
        pluginId: directive.pluginId,
        id: directive.id,
        title: getPluginDisplayName(directive.pluginId),
      }),
    ),
    atom: messageDirectivePicksAtom,
    rule: NO_AUTOMATIC_RULE,
    builtIn: {
      title: "Show as text",
      description: "Shows the directive's source text.",
    },
  };

  return {
    slots: slots.filter(
      (slot) => slot.claimants.length + (slot.builtIn === null ? 0 : 1) >= 2,
    ),
    fileOpeners,
    codeFences,
    directives,
  };
}

export function hasKeyedChoices(choice: KeyedChoice): boolean {
  return choice.claimantsByKey.size > 0;
}

export function PluginSlotChoiceRows() {
  const { slots } = usePluginChoices();
  return slots.map((choice) => (
    <SlotChoiceRow key={choice.label} choice={choice} />
  ));
}

export function FileOpenerChoicesSection() {
  const { fileOpeners } = usePluginChoices();
  if (!hasKeyedChoices(fileOpeners)) return null;
  return (
    <SettingsSection
      title={FILE_OPENERS_TITLE}
      description="Automatically use matching plugins, or choose a viewer for each file type. Right-click a file link for a one-off choice."
    >
      <div className="space-y-5">
        <KeyedChoiceRows choice={fileOpeners} />
      </div>
    </SettingsSection>
  );
}

export function MarkdownRendererChoicesSection() {
  const { codeFences, directives } = usePluginChoices();
  if (!hasKeyedChoices(codeFences) && !hasKeyedChoices(directives)) {
    return null;
  }
  return (
    <SettingsSection
      title={MARKDOWN_SETTINGS_TITLE}
      description="Choose how code blocks and directives are rendered in Markdown."
    >
      <div className="space-y-5">
        <KeyedChoiceRows choice={codeFences} />
        <KeyedChoiceRows choice={directives} />
      </div>
    </SettingsSection>
  );
}

function SlotChoiceRow({ choice }: { choice: SlotChoice }) {
  const [value, setValue] = useAtom(choice.atom);
  return (
    <ReplacementProviderSetting
      label={choice.label}
      description={choice.description}
      triggerAriaLabel={choice.label}
      builtIn={choice.builtIn}
      rule={choice.rule}
      slots={choice.claimants}
      value={value}
      onSelect={setValue}
    />
  );
}

function claimantSetKey(claimants: readonly ChoiceClaimant[]): string {
  return claimants.map(replacementProviderKey).join("\n");
}

function KeyedChoiceRows({ choice }: { choice: KeyedChoice }) {
  const [picks, setPicks] = useAtom(choice.atom);
  const groups = new Map<
    string,
    { keys: string[]; claimants: readonly ChoiceClaimant[]; pick: string }
  >();
  for (const [key, claimants] of [...choice.claimantsByKey].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const pick = picks[key] ?? AUTOMATIC_REPLACEMENT_PROVIDER;
    const groupKey = `${claimantSetKey(claimants)}\n${pick}`;
    const group = groups.get(groupKey);
    if (group === undefined) {
      groups.set(groupKey, { keys: [key], claimants, pick });
    } else {
      group.keys.push(key);
    }
  }
  return [...groups.values()].map((group) => {
    const label = choice.noun(group.keys);
    return (
      <ReplacementProviderSetting
        key={group.keys.join(",")}
        label={label}
        description={choice.description}
        triggerAriaLabel={`Plugin for ${label}`}
        builtIn={choice.builtIn}
        rule={
          choice.rule.automatic === "none" && group.claimants.length === 1
            ? { ...choice.rule, automatic: "ranked" }
            : choice.rule
        }
        slots={group.claimants}
        value={group.pick}
        onSelect={(selection) =>
          setPicks((previous) => {
            const next = { ...previous };
            for (const key of group.keys) {
              if (selection === AUTOMATIC_REPLACEMENT_PROVIDER) {
                delete next[key];
              } else {
                next[key] = selection;
              }
            }
            return next;
          })
        }
      />
    );
  });
}
