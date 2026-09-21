import type { ThreadArchiveFilter } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { normalizeThreadLifecycleFilter } from "@/lib/thread-lifecycle-filter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";

export const THREAD_LIFECYCLE_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const satisfies readonly { value: ThreadArchiveFilter; label: string }[];

interface ThreadLifecycleFilterProps {
  value: readonly ThreadArchiveFilter[];
  onChange: (value: ThreadArchiveFilter[]) => void;
}

export function ThreadLifecycleFilterItems({
  value: savedValue,
  onChange,
}: ThreadLifecycleFilterProps) {
  const value = normalizeThreadLifecycleFilter(savedValue);
  return (
    <>
      {THREAD_LIFECYCLE_OPTIONS.map((option) => {
        const checked = value.includes(option.value);
        const required = checked && value.length === 1;
        return (
          <DropdownMenuItem
            key={option.value}
            role="menuitemcheckbox"
            aria-checked={checked}
            title={
              required ? "Keep at least one filter selected" : undefined
            }
            onSelect={(event) => {
              event.preventDefault();
              if (required) return;
              onChange(
                THREAD_LIFECYCLE_OPTIONS.flatMap((candidate) =>
                  (
                    candidate.value === option.value
                      ? !checked
                      : value.includes(candidate.value)
                  )
                    ? [candidate.value]
                    : [],
                ),
              );
            }}
          >
            {option.label}
            <span className="ml-auto inline-flex size-4 items-center justify-center">
              {checked && <Icon name="Check" className="size-4" />}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function ThreadLifecycleFilter({
  value: savedValue,
  onChange,
}: ThreadLifecycleFilterProps) {
  const value = normalizeThreadLifecycleFilter(savedValue);
  const label =
    value.length === THREAD_LIFECYCLE_OPTIONS.length
      ? "All"
      : THREAD_LIFECYCLE_OPTIONS.filter((option) =>
          value.includes(option.value),
        )
          .map((option) => option.label)
          .join(", ");

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-full justify-start"
          aria-label={`Filter: ${label}`}
        >
          <Icon
            name="SlidersHorizontal"
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="truncate">{label}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Filter">
        <DropdownMenuGroup aria-label="Filter">
          <DropdownMenuLabel>Filter</DropdownMenuLabel>
          <ThreadLifecycleFilterItems value={value} onChange={onChange} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
