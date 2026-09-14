import { useAtom, type WritableAtom } from "jotai";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { SettingsWithControl } from "@/components/ui/settings-section";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";

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
  preferenceAtom,
  slots,
}: {
  label: string;
  description: string;
  triggerAriaLabel: string;
  builtInDescription: string;
  preferenceAtom: WritableAtom<string, [string], void>;
  slots: readonly ReplacementProviderSlot[];
}) {
  const [preference, setPreference] = useAtom(preferenceAtom);

  const automaticProvider = slots[0];
  if (automaticProvider === undefined) return null;
  const builtInOption = {
    key: BUILT_IN_REPLACEMENT_PROVIDER,
    title: "bb (built-in)",
    description: builtInDescription,
  };
  const options = [
    {
      key: AUTOMATIC_REPLACEMENT_PROVIDER,
      title: "Automatic",
      description: `Currently using ${automaticProvider.title} from ${automaticProvider.pluginId}.`,
    },
    builtInOption,
    ...slots.map((slot) => ({
      key: replacementProviderKey(slot),
      title: slot.title,
      description: slot.description ?? `From the ${slot.pluginId} plugin.`,
    })),
  ];
  const selected =
    options.find((option) => option.key === preference) ?? builtInOption;

  return (
    <SettingsWithControl label={label} description={description}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-w-40 justify-between"
            aria-label={triggerAriaLabel}
          >
            <span className="min-w-0 truncate">{selected.title}</span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onSelect={() => setPreference(option.key)}
              className="flex items-start gap-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              </span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto mt-0.5",
                  selected.key !== option.key && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}
