import { useCallback, useMemo, useState } from "react";
import {
  experimental_searchPickerOptions as searchPickerOptions,
  experimental_ThreadTitleText as ThreadTitle,
} from "@get-bb/plugin-sdk/app";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useResetPickerScroll } from "@bb/shared-ui/hooks/use-reset-picker-scroll";
import { ListLoadingPlaceholder } from "@bb/shared-ui/list-loading-placeholder";
import { PICKER_MOBILE_CLASS_NAME } from "@bb/shared-ui/picker-layout";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";

interface ParentThreadPickerOption {
  label: string;
  searchText: string;
  value: string;
}

interface ParentThreadPickerProps {
  value: string;
  options: readonly ParentThreadPickerOption[];
  isLoading: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

export default function ParentThreadPicker({
  value,
  options,
  isLoading,
  disabled,
  onChange,
  onOpenChange,
}: ParentThreadPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const filteredOptions = useMemo(
    () =>
      searchPickerOptions({
        options,
        query: searchQuery,
        getLabel: (option) => option.label,
        getAliases: (option) => [option.value, option.searchText],
      }),
    [options, searchQuery],
  );
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "None";
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setSearchQuery("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "-mx-1 inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1 rounded-sm px-1 leading-tight text-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover data-[state=open]:bg-state-hover focus-visible:ring-2 disabled:cursor-default",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <ThreadTitle
            title={selectedLabel}
            className={cn("text-foreground", COARSE_POINTER_TEXT_SM_CLASS)}
          />
          <Icon
            name="ChevronDown"
            className="size-3 shrink-0 text-subtle-foreground max-md:pointer-coarse:size-5"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        mobileClassName={PICKER_MOBILE_CLASS_NAME}
        align="start"
        className="flex min-h-0 w-72 flex-col p-0 max-md:flex-1"
        mobileTitle="Assign parent thread"
      >
        <Command
          label="Search parent threads"
          shouldFilter={false}
          className="min-h-0"
        >
          <CommandInput
            aria-label="Search parent threads"
            placeholder="Search threads…"
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList
            ref={listRef}
            className="min-h-0 max-h-72 max-md:max-h-none max-md:flex-1"
          >
            {isLoading ? (
              <ListLoadingPlaceholder label="Loading threads…" />
            ) : filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm">
                No matching threads.
              </div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    aria-current={value === option.value ? "true" : undefined}
                    onSelect={() => {
                      onChange(option.value);
                      handleOpenChange(false);
                    }}
                    className="flex items-center justify-between gap-3"
                  >
                    <ThreadTitle title={option.label} tooltip />
                    <Icon
                      name="Check"
                      aria-hidden
                      className={cn(
                        COARSE_POINTER_ICON_SIZE_CLASS,
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
