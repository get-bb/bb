import type { ThreadLifecycle } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
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
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
] as const satisfies readonly { value: ThreadLifecycle; label: string }[];

interface ThreadLifecycleFilterProps {
  value: readonly ThreadLifecycle[];
  onChange: (value: ThreadLifecycle[]) => void;
}

export function ThreadLifecycleFilterItems({
  value,
  onChange,
}: ThreadLifecycleFilterProps) {
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
            disabled={required}
            title={
              required ? "Keep at least one lifecycle selected" : undefined
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
  value,
  onChange,
}: ThreadLifecycleFilterProps) {
  const label = THREAD_LIFECYCLE_OPTIONS.filter((option) =>
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
          aria-label={`Thread lifecycle: ${label}`}
        >
          <span className="truncate">{label}</span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle="Thread lifecycle">
        <DropdownMenuGroup aria-label="Thread lifecycle">
          <DropdownMenuLabel>Thread lifecycle</DropdownMenuLabel>
          <ThreadLifecycleFilterItems value={value} onChange={onChange} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
