import { useAtom } from "jotai";
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
  BUILT_IN_THREAD_LIST_PROVIDER,
  threadListProviderAtom,
  threadListProviderKey,
} from "@/components/sidebar/threadListProvider";
import { usePluginSlots } from "@/lib/plugin-slots";

const BUILT_IN_OPTION = {
  key: BUILT_IN_THREAD_LIST_PROVIDER,
  title: "bb (built-in)",
  description: "Projects, sections, and nested threads.",
} as const;

/**
 * Picks which thread list fills the sidebar. Rendered only while at least one
 * plugin registers an `experimental_threadList`, so the setting appears with
 * the capability rather than sitting inert for everyone else.
 */
export function SidebarThreadListSetting() {
  const { threadLists } = usePluginSlots();
  const [preference, setPreference] = useAtom(threadListProviderAtom);

  if (threadLists.length === 0) return null;

  const options = [
    BUILT_IN_OPTION,
    ...threadLists.map((slot) => ({
      key: threadListProviderKey(slot),
      title: slot.title,
      description: slot.description ?? `From the ${slot.pluginId} plugin.`,
    })),
  ];
  // An unresolvable preference (plugin disabled or still loading) reads as the
  // built-in list, which is exactly what the sidebar renders in that state.
  const selected =
    options.find((option) => option.key === preference) ?? BUILT_IN_OPTION;

  return (
    <SettingsWithControl
      label="Sidebar"
      description="Which thread list fills the sidebar on this device."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-w-40 justify-between"
            aria-label="Sidebar thread list"
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
