import { useMemo, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@bb/shared-ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentLabelIconName,
  REUSE_ENVIRONMENT_ICON_NAME,
  UNNAMED_ENVIRONMENT_LABEL,
} from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { resolveEnvironmentDisplayName } from "@bb/core-ui";
import {
  ThreadTitle,
  useResolveThreadTitle,
} from "@/components/thread/ThreadTitleMentions";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

const REUSE_THREAD_PREVIEW_LIMIT = 2;
const REUSE_SEARCH_MIN_OPTIONS = 7;

function reuseOptionSearchText(
  option: ReuseThreadOption,
  providers: readonly SystemEnvironmentProvider[] | undefined,
  resolveTitle: (title: string) => string,
): string {
  const { label, secondaryText } = reuseThreadOptionDisplay(option, providers);
  return [
    label,
    option.name,
    option.branchName,
    option.path,
    secondaryText,
    ...option.threads.flatMap((thread) => [
      thread.title,
      resolveTitle(thread.title),
    ]),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

export function filterReuseThreadOptions(
  options: readonly ReuseThreadOption[],
  query: string,
  providers: readonly SystemEnvironmentProvider[] | undefined,
  resolveTitle: (title: string) => string,
): readonly ReuseThreadOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((option) => {
    const haystack = reuseOptionSearchText(option, providers, resolveTitle);
    return terms.every((term) => haystack.includes(term));
  });
}

export interface ReuseThreadOption {
  environmentId: string;
  branchName: string | null;
  name: string | null;
  path: string | null;
  environmentProviderId: string | null;
  hostName?: string | null;
  threads: ReadonlyArray<{ id: string; title: string }>;
}

export function reuseThreadOptionDisplay(
  option: ReuseThreadOption,
  providers: readonly SystemEnvironmentProvider[] | undefined,
): { label: string; icon: IconName; secondaryText: string | null } {
  const providerLookup = findEnvironmentDisplayProvider(
    providers,
    option.environmentProviderId,
  );
  return {
    label:
      resolveEnvironmentDisplayName(
        {
          name: option.name,
          branchName: option.branchName,
          path: option.path,
          environmentProviderId: option.environmentProviderId,
        },
        providerLookup,
      ) ?? UNNAMED_ENVIRONMENT_LABEL,
    icon: getEnvironmentLabelIconName(providerLookup),
    secondaryText: option.hostName ?? null,
  };
}

interface ReuseEnvironmentPickerProps {
  options: readonly ReuseThreadOption[];
  value: string | null;
  onChange: (environmentId: string) => void;
  muted?: boolean;
  disabled?: boolean;
  modal?: boolean;
}

export function ReuseEnvironmentPicker({
  options,
  value,
  onChange,
  muted,
  disabled = false,
  modal,
}: ReuseEnvironmentPickerProps) {
  const { providers } = useSystemEnvironmentProviders();
  const resolveTitle = useResolveThreadTitle();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeOption = useMemo(
    () => options.find((option) => option.environmentId === value) ?? null,
    [options, value],
  );
  const showSearch = options.length >= REUSE_SEARCH_MIN_OPTIONS;
  const visibleOptions = useMemo(
    () =>
      showSearch
        ? filterReuseThreadOptions(
            options,
            searchQuery,
            providers,
            resolveTitle,
          )
        : options,
    [options, providers, resolveTitle, searchQuery, showSearch],
  );
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearchQuery("");
  };
  const trigger =
    activeOption === null
      ? { label: "Pick an environment", icon: REUSE_ENVIRONMENT_ICON_NAME }
      : reuseThreadOptionDisplay(activeOption, providers);
  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Environment"
          disabled={disabled}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            !disabled && LIST_HOVER_TRANSITION,
            muted && OPTION_MUTED_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={trigger.icon}
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {trigger.label}
            </span>
          </span>
          {disabled ? null : (
            <Icon
              name="ChevronDown"
              className={cn(
                "shrink-0 text-muted-foreground",
                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
              )}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Reuse an existing environment"
        mobileTitle="Environment"
        className={cn(
          OPTION_MENU_CONTENT_CLASS_NAME,
          "flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-auto max-w-80 min-w-52 flex-col overflow-hidden p-0 max-md:min-h-0 max-md:w-full max-md:flex-1",
        )}
      >
        <Command label="Search environments" shouldFilter={false}>
          {showSearch ? (
            <CommandInput
              aria-label="Search environments"
              placeholder="Search environments"
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="h-8 text-xs"
            />
          ) : null}
          <CommandList className="min-h-0 max-h-none flex-1 overscroll-contain">
            {options.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                Nothing to reuse yet.
              </div>
            ) : (
              <>
                <CommandEmpty className="px-2 py-2 text-xs text-muted-foreground">
                  No environments match.
                </CommandEmpty>
                <CommandGroup heading="Reuse an existing environment">
                  {visibleOptions.map((option) => (
                    <ReuseEnvironmentMenuItem
                      key={option.environmentId}
                      option={option}
                      providers={providers}
                      isSelected={option.environmentId === value}
                      onSelect={(environmentId) => {
                        onChange(environmentId);
                        handleOpenChange(false);
                      }}
                    />
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface ReuseEnvironmentMenuItemProps {
  option: ReuseThreadOption;
  providers: readonly SystemEnvironmentProvider[] | undefined;
  isSelected: boolean;
  onSelect: (environmentId: string) => void;
}

function ReuseEnvironmentMenuItem({
  option,
  providers,
  isSelected,
  onSelect,
}: ReuseEnvironmentMenuItemProps) {
  const previewThreads = option.threads.slice(0, REUSE_THREAD_PREVIEW_LIMIT);
  const additionalCount = option.threads.length - previewThreads.length;
  const { label, icon, secondaryText } = reuseThreadOptionDisplay(
    option,
    providers,
  );
  const branchDetail = option.name ? option.branchName : null;
  return (
    <CommandItem
      value={option.environmentId}
      aria-current={isSelected ? "true" : undefined}
      onSelect={() => onSelect(option.environmentId)}
      className={cn(
        "flex flex-col items-stretch gap-1 py-2",
        LIST_HOVER_TRANSITION,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          name={icon}
          className={cn(
            "shrink-0 text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
          )}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate text-xs">
          <span className="min-w-0 truncate font-medium">{label}</span>
          {branchDetail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {branchDetail}
            </span>
          ) : null}
        </span>
        <Icon
          name="Check"
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            isSelected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
      {secondaryText ? (
        <span className="truncate pl-6 text-xs text-muted-foreground">
          {secondaryText}
        </span>
      ) : null}
      {previewThreads.length > 0 ? (
        <span className="flex flex-col gap-0.5 pl-6 text-xs text-muted-foreground">
          {previewThreads.map((thread) => (
            <ThreadTitle key={thread.id} title={thread.title} />
          ))}
          {additionalCount > 0 ? (
            <span className="text-muted-foreground">
              +{additionalCount} more
            </span>
          ) : null}
        </span>
      ) : null}
    </CommandItem>
  );
}
