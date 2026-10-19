import { useAtom, type WritableAtom } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  findAutomaticReplacement,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import { useBuiltinPluginIds } from "@/lib/plugin-slots";
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
  preferenceAtom,
  slots,
}: {
  label: string;
  description: string;
  triggerAriaLabel: string;
  builtInDescription?: string;
  allowAutomatic?: boolean;
  preferenceAtom: WritableAtom<string, [string], void>;
  slots: readonly ReplacementProviderSlot[];
}) {
  const [preference, setPreference] = useAtom(preferenceAtom);

  const builtinPluginIds = useBuiltinPluginIds();
  const isBuiltin = (slot: ReplacementProviderSlot) =>
    builtinPluginIds.has(slot.pluginId);
  const automaticProvider = findAutomaticReplacement(slots, builtinPluginIds);
  if (automaticProvider === undefined) return null;
  const automaticOption = {
    key: AUTOMATIC_REPLACEMENT_PROVIDER,
    title: "Automatic",
    description: `Chooses ${automaticProvider.title} (${
      isBuiltin(automaticProvider) ? "built-in" : automaticProvider.pluginId
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
  const optionFor = (slot: ReplacementProviderSlot) =>
    isBuiltin(slot)
      ? {
          key: replacementProviderKey(slot),
          title: `${slot.title} (built-in)`,
          description: slot.description ?? "",
        }
      : {
          key: replacementProviderKey(slot),
          title: slot.title,
          description:
            slot.description === undefined
              ? `From the ${slot.pluginId} plugin.`
              : `${slot.pluginId} plugin. ${slot.description}`,
        };
  const options = [
    ...(allowAutomatic ? [automaticOption] : []),
    ...slots.filter((slot) => !isBuiltin(slot)).map(optionFor),
    ...slots.filter(isBuiltin).map(optionFor),
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
