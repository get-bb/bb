import { useAtom, type WritableAtom } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  findAutomaticReplacement,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import { ChoiceDropdownSetting } from "./ChoiceDropdownSetting";

interface ReplacementProviderSlot {
  pluginId: string;
  id: string;
  title: string;
  description?: string;
}

export function ReplacementProviderSetting({
  label,
  description,
  triggerAriaLabel,
  builtInDescription,
  allowAutomatic = true,
  bundledProvider,
  preferenceAtom,
  slots,
}: {
  label: string;
  description: string;
  triggerAriaLabel: string;
  builtInDescription?: string;
  allowAutomatic?: boolean;
  bundledProvider?: string;
  preferenceAtom: WritableAtom<string, [string], void>;
  slots: readonly ReplacementProviderSlot[];
}) {
  const [preference, setPreference] = useAtom(preferenceAtom);

  const automaticProvider = findAutomaticReplacement(slots, bundledProvider);
  if (automaticProvider === undefined) return null;
  const automaticOption = {
    key: AUTOMATIC_REPLACEMENT_PROVIDER,
    title: "Automatic",
    description: `Chooses ${automaticProvider.title} (${
      replacementProviderKey(automaticProvider) === bundledProvider
        ? "built-in"
        : automaticProvider.pluginId
    }).`,
  };
  const builtInOption =
    builtInDescription === undefined
      ? null
      : {
          key: BUILT_IN_REPLACEMENT_PROVIDER,
          title: "bb (built-in)",
          description: builtInDescription,
        };
  const pluginOptions = slots.map((slot) => {
    const bundled = replacementProviderKey(slot) === bundledProvider;
    return {
      key: replacementProviderKey(slot),
      title: bundled ? `${slot.title} (built-in)` : slot.title,
      description: bundled
        ? `BB default. ${slot.description ?? ""}`.trim()
        : slot.description === undefined
          ? `From the ${slot.pluginId} plugin.`
          : `${slot.pluginId} plugin. ${slot.description}`,
    };
  });
  const options = [
    ...(allowAutomatic ? [automaticOption] : []),
    ...pluginOptions.filter((option) => option.key !== bundledProvider),
    ...pluginOptions.filter((option) => option.key === bundledProvider),
    ...(builtInOption === null ? [] : [builtInOption]),
  ];
  const selected =
    options.find((option) => option.key === preference) ??
    builtInOption ??
    (allowAutomatic
      ? automaticOption
      : { key: preference, title: "Unavailable plugin" });

  return (
    <ChoiceDropdownSetting
      label={label}
      description={description}
      triggerAriaLabel={triggerAriaLabel}
      options={options}
      selected={selected}
      onSelect={setPreference}
    />
  );
}
