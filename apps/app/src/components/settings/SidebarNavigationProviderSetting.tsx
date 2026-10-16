import { useAtom } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  BUILT_IN_NAVIGATION_PROVIDERS,
  RAIL_NAVIGATION,
  sidebarNavigationProviderAtom,
} from "@/components/sidebar/sidebarNavigationProvider";
import { ChoiceDropdownSetting } from "./ChoiceDropdownSetting";

export function SidebarNavigationProviderSetting() {
  const { experimentalSidebarNavigations } = usePluginSlots();
  const [preference, setPreference] = useAtom(sidebarNavigationProviderAtom);
  const automaticSlot = experimentalSidebarNavigations[0];
  const options = [
    {
      key: AUTOMATIC_REPLACEMENT_PROVIDER,
      title: "Automatic",
      description:
        automaticSlot === undefined
          ? `Chooses ${RAIL_NAVIGATION.title} (built-in).`
          : `Chooses ${automaticSlot.title} (${automaticSlot.pluginId}).`,
    },
    ...BUILT_IN_NAVIGATION_PROVIDERS.map((provider) => ({
      key: provider.key,
      title: provider.title,
      description: provider.description,
    })),
    ...experimentalSidebarNavigations.map((slot) => ({
      key: replacementProviderKey(slot),
      title: slot.title,
      description:
        slot.description === undefined
          ? `From the ${slot.pluginId} plugin.`
          : `${slot.pluginId} plugin. ${slot.description}`,
    })),
  ];
  const selected = options.find((option) => option.key === preference) ?? {
    key: preference,
    title: "Unavailable plugin",
  };
  return (
    <ChoiceDropdownSetting
      label="Navigation"
      description="What draws New thread, Plugins, Skills, and plugin pages in the sidebar."
      triggerAriaLabel="Sidebar navigation"
      options={options}
      selected={selected}
      onSelect={setPreference}
    />
  );
}
