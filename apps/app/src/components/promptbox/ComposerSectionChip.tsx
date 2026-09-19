import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@bb/shared-ui/command";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";

const NO_SECTION_LABEL = "Threads";
const SECTION_CHIP_ITEM_CLASS_NAME = "py-[0.3125rem] text-xs max-md:py-2";

export interface ComposerSectionOption {
  id: string;
  name: string;
}

interface ComposerSectionChipProps {
  sections: readonly ComposerSectionOption[];
  value: string | null;
  onChange: (sectionId: string | null) => void;
}

export function ComposerSectionChip({
  sections,
  value,
  onChange,
}: ComposerSectionChipProps) {
  const [open, setOpen] = useState(false);
  const selected =
    value === null
      ? null
      : (sections.find((section) => section.id === value) ?? null);
  const label = selected?.name ?? NO_SECTION_LABEL;
  const selectSection = (sectionId: string | null) => {
    onChange(sectionId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Section: ${label}`}
          className="h-7 max-w-full gap-1.5 rounded-full bg-muted py-0 pl-2.5 pr-2 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground"
        >
          <Icon name="Layers" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{label}</span>
          <Icon
            name="ChevronDown"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Section"
        mobileTitle="Section"
        className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-52 flex-col overflow-hidden p-0 max-md:min-h-0 max-md:flex-1"
      >
        <Command label="Sections" shouldFilter={false} className="min-h-0">
          <CommandList className="min-h-0 max-h-none flex-1 overscroll-contain">
            <CommandGroup heading="Section">
              {sections.map((section) => (
                <CommandItem
                  key={section.id}
                  value={section.id}
                  aria-current={section.id === value ? "true" : undefined}
                  onSelect={() => selectSection(section.id)}
                  className={SECTION_CHIP_ITEM_CLASS_NAME}
                >
                  <Icon
                    name="Layers"
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {section.name}
                  </span>
                  <Icon
                    name="Check"
                    className={cn(
                      "ml-auto size-4",
                      section.id === value ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__composer-no-section__"
                aria-current={value === null ? "true" : undefined}
                onSelect={() => selectSection(null)}
                className={SECTION_CHIP_ITEM_CLASS_NAME}
              >
                <Icon
                  name="MessageSquare"
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">
                  {NO_SECTION_LABEL}
                </span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto size-4",
                    value === null ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
