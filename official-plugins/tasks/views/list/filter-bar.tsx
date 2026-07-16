import type { ReactNode } from "react";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PriorityIcon, StatusIcon } from "./icons.js";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type LabelFilterOption,
} from "./lib.js";

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  if (checked) return values.includes(value) ? [...values] : [...values, value];
  return values.filter((existing) => existing !== value);
}

function FilterChip({
  icon,
  label,
  selectedNames,
  children,
}: {
  icon: IconName;
  label: string;
  selectedNames: readonly string[];
  children: ReactNode;
}) {
  const active = selectedNames.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs",
            active
              ? "border-border bg-secondary text-foreground"
              : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
          )}
        >
          <Icon name={icon} className="size-3" />
          {label}
          {active ? (
            <span className="max-w-48 truncate font-medium">
              {selectedNames.join(", ")}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ListFilterState {
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  labelNames: string[];
}

export const EMPTY_FILTERS: ListFilterState = {
  statuses: [],
  priorities: [],
  labelNames: [],
};

export function hasActiveFilters(filters: ListFilterState): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelNames.length > 0
  );
}

export function ListFilterBar({
  filters,
  onChange,
  labelOptions,
  taskCount,
}: {
  filters: ListFilterState;
  onChange: (filters: ListFilterState) => void;
  labelOptions: readonly LabelFilterOption[];
  taskCount: number | undefined;
}) {
  const keepOpen = (event: Event) => event.preventDefault();
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-hairline px-3.5 py-1.5">
      <FilterChip
        icon="Circle"
        label="Status"
        selectedNames={filters.statuses.map((status) => STATUS_LABELS[status])}
      >
        {TASK_STATUSES.map((status) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={filters.statuses.includes(status)}
            onSelect={keepOpen}
            onCheckedChange={(checked) =>
              onChange({
                ...filters,
                statuses: toggled(filters.statuses, status, checked === true),
              })
            }
          >
            <span className="flex items-center gap-2">
              <StatusIcon status={status} className="size-3" />
              {STATUS_LABELS[status]}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </FilterChip>
      <FilterChip
        icon="ArrowUpDown"
        label="Priority"
        selectedNames={filters.priorities.map(
          (priority) => PRIORITY_LABELS[priority],
        )}
      >
        {TASK_PRIORITIES.map((priority) => (
          <DropdownMenuCheckboxItem
            key={priority}
            checked={filters.priorities.includes(priority)}
            onSelect={keepOpen}
            onCheckedChange={(checked) =>
              onChange({
                ...filters,
                priorities: toggled(
                  filters.priorities,
                  priority,
                  checked === true,
                ),
              })
            }
          >
            <span className="flex items-center gap-2">
              <PriorityIcon priority={priority} className="size-3" />
              {PRIORITY_LABELS[priority]}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </FilterChip>
      {labelOptions.length > 0 ? (
        <FilterChip
          icon="ListTodo"
          label="Label"
          selectedNames={filters.labelNames}
        >
          {labelOptions.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.name}
              checked={filters.labelNames.includes(option.name)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  labelNames: toggled(
                    filters.labelNames,
                    option.name,
                    checked === true,
                  ),
                })
              }
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
                {option.name}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
      ) : null}
      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground"
        >
          <Icon name="X" className="size-3" />
          Clear
        </button>
      ) : null}
      <span className="ml-auto text-xs tabular-nums text-subtle-foreground">
        {taskCount === undefined
          ? ""
          : `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
      </span>
    </div>
  );
}
