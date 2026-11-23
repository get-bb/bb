import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  effectiveReplacementPreference,
  findAutomaticReplacement,
  replacementProviderKey,
  type ExclusiveRule,
} from "@/lib/plugin-replacement-preference";
import { useBbPluginIds } from "@/lib/plugin-slots";
import {
  ChoiceDropdownSetting,
  type ChoiceDropdownOption,
} from "./ChoiceDropdownSetting";

interface ReplacementProviderSlot {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
}

export interface BuiltInChoice {
  title: string;
  description: string;
}

export function ReplacementProviderSetting({
  label,
  description,
  triggerAriaLabel,
  builtIn,
  rule,
  slots,
  value,
  onSelect,
}: {
  label: string;
  description: string | null;
  triggerAriaLabel: string;
  builtIn: BuiltInChoice | null;
  rule: ExclusiveRule;
  slots: readonly ReplacementProviderSlot[];
  value: string;
  onSelect: (value: string) => void;
}) {
  const bbPluginIds = useBbPluginIds();
  const isBundled = (slot: ReplacementProviderSlot) =>
    bbPluginIds.has(slot.pluginId);
  const automaticProvider =
    rule.automatic === "ranked"
      ? findAutomaticReplacement(slots, bbPluginIds)
      : undefined;
  if (slots.length === 0) return null;
  const automaticOption: ChoiceDropdownOption =
    rule.automatic === "none"
      ? {
          key: AUTOMATIC_REPLACEMENT_PROVIDER,
          title: "Not chosen",
          description:
            "Shows a plugin picker in the message, with the directive text, until you pick a plugin.",
        }
      : {
          key: AUTOMATIC_REPLACEMENT_PROVIDER,
          title: "Automatic",
          description:
            automaticProvider === undefined
              ? `Chooses ${builtIn?.title ?? "bb"}.`
              : `Chooses ${automaticProvider.title} (${
                  isBundled(automaticProvider)
                    ? "from bb"
                    : automaticProvider.pluginId
                }).`,
        };
  const sharedTitles = new Set(
    slots
      .filter((slot, index) =>
        slots.some(
          (other, otherIndex) =>
            otherIndex !== index && other.title === slot.title,
        ),
      )
      .map((slot) => slot.title),
  );
  const titleOf = (slot: ReplacementProviderSlot) =>
    sharedTitles.has(slot.title)
      ? `${slot.title} (${slot.pluginId})`
      : slot.title;
  const optionFor = (slot: ReplacementProviderSlot): ChoiceDropdownOption =>
    isBundled(slot)
      ? {
          key: replacementProviderKey(slot),
          title: `${titleOf(slot)} (from bb)`,
          description: slot.description ?? `From the ${slot.pluginId} plugin.`,
        }
      : {
          key: replacementProviderKey(slot),
          title: titleOf(slot),
          description:
            slot.description === undefined
              ? `From the ${slot.pluginId} plugin.`
              : `${slot.pluginId} plugin. ${slot.description}`,
        };
  const options = [
    automaticOption,
    ...slots.filter((slot) => !isBundled(slot)).map(optionFor),
    ...slots.filter(isBundled).map(optionFor),
    ...(rule.builtin && builtIn !== null
      ? [{ key: BUILT_IN_REPLACEMENT_PROVIDER, ...builtIn }]
      : []),
  ];
  const effective = effectiveReplacementPreference(slots, value, rule);
  const selected =
    options.find((option) => option.key === effective) ?? automaticOption;

  return (
    <ChoiceDropdownSetting
      label={label}
      description={description}
      triggerAriaLabel={triggerAriaLabel}
      options={options}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
