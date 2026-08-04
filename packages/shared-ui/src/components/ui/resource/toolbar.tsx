import type { ReactNode } from "react";
import { Button } from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { Icon, type IconName } from "../icon";
import { Input } from "../input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../../../lib/utils";

export function ResourceToolbar({
  searchValue,
  searchPlaceholder,
  searchLabel,
  onSearchChange,
  controls,
  containedControls = false,
  controlsClassName,
  action,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchLabel?: string;
  onSearchChange: (value: string) => void;
  controls?: ReactNode;
  containedControls?: boolean;
  controlsClassName?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel ?? searchPlaceholder}
          className="h-8 pl-8"
        />
      </div>
      {controls ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            containedControls &&
              "h-8 gap-0.5 rounded-md bg-surface-recessed p-0.5 [&>button]:size-7 [&>button]:rounded-sm",
            controlsClassName,
          )}
        >
          {controls}
        </div>
      ) : null}
      {action}
    </div>
  );
}

export function ResourceTabDescription({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl px-1 text-sm leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

export interface ResourceOption {
  id: string;
  label: string;
  leading?: ReactNode;
  description?: string;
  disabled?: boolean;
}

function ResourceOptionContent({ option }: { option: ResourceOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.leading ? (
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {option.leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs">{option.label}</span>
        {option.description ? (
          <span className="truncate text-2xs text-subtle-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function ResourceMenuTrigger({
  label,
  icon,
  active = false,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-8 shrink-0 p-0 text-muted-foreground",
                active && "bg-state-active text-foreground",
              )}
              aria-label={label}
            >
              <Icon name={icon} className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceOptionMenu({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: string;
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <ResourceMenuTrigger label={label} icon={icon} />
      <DropdownMenuContent align="end" mobileTitle={label} className="min-w-40">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          {label}
        </DropdownMenuLabel>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={option.disabled}
              onSelect={(event) => {
                if (selected || option.disabled) {
                  event.preventDefault();
                  return;
                }
                onChange(option.id);
              }}
              className="flex items-center justify-between gap-3"
            >
              <ResourceOptionContent option={option} />
              <Icon
                name="Check"
                aria-hidden
                className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceMultiSelectMenu({
  label,
  icon,
  selectedValues,
  options,
  onChange,
}: {
  label: string;
  icon: IconName;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
}) {
  const selected = new Set(selectedValues);
  const activeSelectedCount = options.filter(
    (option) => !option.disabled && selected.has(option.id),
  ).length;
  const triggerLabel =
    activeSelectedCount === 0
      ? label
      : `${label}: ${activeSelectedCount} selected`;

  function updateValue(option: ResourceOption, checked: boolean) {
    if (option.disabled) return;
    const next = new Set(selectedValues);
    if (checked) {
      next.add(option.id);
    } else {
      next.delete(option.id);
    }
    const enabledOptionIds = new Set(
      options.filter((candidate) => !candidate.disabled).map(({ id }) => id),
    );
    onChange([...next].filter((id) => enabledOptionIds.has(id)));
  }

  return (
    <DropdownMenu>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon={icon}
        active={activeSelectedCount > 0}
      />
      <DropdownMenuContent align="end" mobileTitle={label} className="min-w-44">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          {triggerLabel}
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selected.has(option.id)}
            disabled={option.disabled}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => updateValue(option, checked === true)}
          >
            <ResourceOptionContent option={option} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceSortMenu({
  value,
  direction,
  options,
  onChange,
}: {
  value: string;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <ResourceMenuTrigger label="Sort" icon="ArrowUpDown" />
      <DropdownMenuContent align="end" mobileTitle="Sort" className="min-w-40">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
          Sort by
        </DropdownMenuLabel>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <DropdownMenuItem
              key={option.id}
              disabled={option.disabled}
              onSelect={(event) => {
                event.preventDefault();
                if (option.disabled) return;
                onChange(option.id);
              }}
              className="flex items-center justify-between gap-3"
            >
              <ResourceOptionContent option={option} />
              <Icon
                name={direction === "asc" ? "ArrowUp" : "ArrowDown"}
                aria-hidden
                className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceToolbarAction({
  label,
  icon = "Plus",
  disabled = false,
  onClick,
}: {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

export interface ResourceCreateTemplate {
  label: string;
  description: string;
  prompt: string;
  icon?: IconName;
}

export interface ResourceCreateMenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
}

export function ResourceCreateButton({
  label,
  templates,
  templateMenuLabel = "Examples",
  menuActions = [],
  onCreate,
}: {
  label: string;
  templates: readonly ResourceCreateTemplate[];
  templateMenuLabel?: string;
  menuActions?: readonly ResourceCreateMenuAction[];
  onCreate: (prompt?: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <Button
        type="button"
        size="sm"
        className="rounded-r-none"
        onClick={() => onCreate()}
      >
        <Icon name="MessageCirclePlus" className="size-4" aria-hidden />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label={`${label} options`}
            className="rounded-l-none px-1.5"
          >
            <Icon name="ChevronDown" className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-40 w-max"
          mobileTitle={templateMenuLabel}
        >
          {menuActions.map((action) => (
            <DropdownMenuItem key={action.label} onSelect={action.onSelect}>
              <Icon name={action.icon} className="size-4" aria-hidden />
              {action.label}
            </DropdownMenuItem>
          ))}
          {menuActions.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
            {templateMenuLabel}
          </DropdownMenuLabel>
          {templates.map((template) => (
            <DropdownMenuItem
              key={template.label}
              className="py-2"
              onSelect={() => onCreate(template.prompt)}
            >
              {template.icon ? (
                <Icon
                  name={template.icon}
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              ) : null}
              <span className="min-w-0 truncate text-sm text-foreground">
                {template.label}
              </span>
              <span className="sr-only">: {template.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
