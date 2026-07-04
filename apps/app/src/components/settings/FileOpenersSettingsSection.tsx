import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  buildFileOpenerRef,
  resolvePreferredFileOpener,
  useFileOpenerPreference,
} from "@/lib/file-opener-preference";
import { usePluginSlots, type PluginFileOpenerSlot } from "@/lib/plugin-slots";
import { cn } from "@/lib/utils";

const DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";

/**
 * Default viewer per file extension (Settings → File openers). One row per
 * extension any installed plugin registers a `fileOpener` for: built-in
 * preview (the default) or a plugin opener. Hidden entirely while no plugin
 * openers are installed — the built-in preview needs no configuration.
 */
export function FileOpenersSettingsSection() {
  const { fileOpeners } = usePluginSlots();
  const [preference, setPreference] = useFileOpenerPreference();

  const extensions = useMemo(
    () =>
      [...new Set(fileOpeners.flatMap((opener) => opener.extensions))].sort(),
    [fileOpeners],
  );

  if (extensions.length === 0) {
    return null;
  }

  return (
    <SettingsSection
      title="File openers"
      description="Which viewer opens each file type in the right panel. Right-click a file link for a one-off choice."
    >
      <div className="space-y-5">
        {extensions.map((extension) => (
          <ExtensionOpenerControl
            key={extension}
            extension={extension}
            openers={fileOpeners.filter((opener) =>
              opener.extensions.includes(extension),
            )}
            selected={resolvePreferredFileOpener({
              openers: fileOpeners,
              preference,
              path: `file.${extension}`,
            })}
            onSelect={(opener) =>
              setPreference((previous) => {
                const next = { ...previous };
                if (opener === null) {
                  delete next[extension];
                } else {
                  next[extension] = buildFileOpenerRef(opener);
                }
                return next;
              })
            }
          />
        ))}
      </div>
    </SettingsSection>
  );
}

const BUILTIN_LABEL = "Built-in preview";

function ExtensionOpenerControl({
  extension,
  onSelect,
  openers,
  selected,
}: {
  extension: string;
  onSelect: (opener: PluginFileOpenerSlot | null) => void;
  openers: PluginFileOpenerSlot[];
  selected: PluginFileOpenerSlot | null;
}) {
  const selectedLabel =
    selected === null ? BUILTIN_LABEL : `${selected.title} (${selected.pluginId})`;
  return (
    <SettingsWithControl label={`.${extension} files`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={DROPDOWN_TRIGGER_CLASS}
            aria-label={`Default opener for .${extension} files`}
          >
            <span className="min-w-0 truncate">{selectedLabel}</span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={DROPDOWN_CONTENT_CLASS}>
          <DropdownMenuItem onSelect={() => onSelect(null)}>
            <span className="min-w-0 truncate">{BUILTIN_LABEL}</span>
            <Icon
              name="Check"
              className={cn(
                "ml-auto",
                selected !== null && "opacity-0",
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
            />
          </DropdownMenuItem>
          {openers.map((opener) => (
            <DropdownMenuItem
              key={buildFileOpenerRef(opener)}
              onSelect={() => onSelect(opener)}
            >
              <span className="min-w-0 truncate">
                {opener.title} ({opener.pluginId})
              </span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  (selected === null ||
                    buildFileOpenerRef(selected) !==
                      buildFileOpenerRef(opener)) &&
                    "opacity-0",
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
