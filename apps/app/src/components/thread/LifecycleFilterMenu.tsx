import type { ThreadLifecycle } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import {
  THREAD_LIFECYCLE_OPTIONS,
  toggleThreadLifecycle,
} from "@/lib/thread-lifecycle-filter";

interface LifecycleFilterMenuProps {
  label: string;
  value: readonly ThreadLifecycle[];
  onChange: (value: ThreadLifecycle[]) => void;
}

export function LifecycleFilterMenu({
  label,
  value,
  onChange,
}: LifecycleFilterMenuProps) {
  const selectedLabel = THREAD_LIFECYCLE_OPTIONS.filter((option) =>
    value.includes(option.value),
  )
    .map((option) => option.label)
    .join(", ");
  const isDefault = value.length === 1 && value[0] === "active";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`${label}: ${selectedLabel}`}
          className="h-7 min-w-0 gap-1.5 px-1 text-xs font-normal text-muted-foreground"
        >
          <Icon name="SlidersHorizontal" className="size-3.5 shrink-0" />
          <span className="truncate">{selectedLabel}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle={label}>
        {THREAD_LIFECYCLE_OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={value.includes(option.value)}
            disabled={value.length === 1 && value.includes(option.value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() =>
              onChange(toggleThreadLifecycle(value, option.value))
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        {!isDefault ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(["active"])}>
              Reset to Active
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
