import { useAtom, type WritableAtom } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
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

  const automaticProvider = slots[0];
  if (automaticProvider === undefined) return null;
  const automaticOption = {
    key: AUTOMATIC_REPLACEMENT_PROVIDER,
    title: "Automatic",
    description: `Currently using ${automaticProvider.title} from ${automaticProvider.pluginId}.`,
  };
  const builtInOption =
    builtInDescription === undefined
      ? null
      : {
          key: BUILT_IN_REPLACEMENT_PROVIDER,
          title: "bb (built-in)",
          description: builtInDescription,
        };
  const options = [
    ...(allowAutomatic ? [automaticOption] : []),
    ...(builtInOption === null ? [] : [builtInOption]),
    ...slots.map((slot) => ({
      key: replacementProviderKey(slot),
      title: slot.title,
      description: slot.description ?? `From the ${slot.pluginId} plugin.`,
    })),
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
