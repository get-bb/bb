import { useEffect, type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonProps } from "./button";
import { EmptyStatePanel } from "./empty-state";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Icon, type IconName } from "./icon";
import { Input } from "./input";
import { Skeleton } from "./skeleton";
import { ScrollArea } from "./scroll-area";
import { Textarea } from "./textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "../../lib/utils";

export type ResourceStatusTone = "success" | "warning" | "error" | "muted";

export const RESOURCE_ROUTE_LABEL_EVENT = "bb:resource-route-label";

/**
 * Supplies the loaded resource name to the host shell without coupling the
 * shell to a particular resource API. The DOM event also crosses the frontend
 * plugin boundary, where React context is not shared with the host bundle.
 */
export function useResourceRouteLabel(label: string | null | undefined) {
  useEffect(() => {
    if (!label || typeof window === "undefined") return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      window.dispatchEvent(
        new CustomEvent(RESOURCE_ROUTE_LABEL_EVENT, { detail: { label } }),
      );
    });

    return () => {
      active = false;
      window.dispatchEvent(
        new CustomEvent(RESOURCE_ROUTE_LABEL_EVENT, {
          detail: { label: null },
        }),
      );
    };
  }, [label]);
}

function targetsResourceAction(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("a, button, [data-row-action]") !== null
  );
}

export function ResourceState({
  tone,
  showLabel = true,
  showIndicator = true,
  tooltip,
  accessibleLabel,
  children,
}: {
  tone: ResourceStatusTone;
  showLabel?: boolean;
  showIndicator?: boolean;
  tooltip?: ReactNode;
  accessibleLabel?: string;
  children: ReactNode;
}) {
  const status = (
    <span
      aria-label={accessibleLabel}
      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      {showIndicator ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "error" && "bg-destructive",
            tone === "muted" && "bg-muted-foreground/50",
          )}
        />
      ) : null}
      {showLabel ? <span className="truncate">{children}</span> : null}
    </span>
  );
  if (tooltip === undefined || tooltip === null) return status;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{status}</TooltipTrigger>
        <TooltipContent className="max-w-sm">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const ResourceStatus = ResourceState;

export function ResourceMeta({
  items,
}: {
  items: readonly (ReactNode | null | undefined | false)[];
}) {
  const visibleItems = items.filter(Boolean);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {visibleItems.map((item, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-subtle-foreground">
              ·
            </span>
          ) : null}
          <span className="min-w-0 truncate">{item}</span>
        </span>
      ))}
    </span>
  );
}

export function ResourceLocationMeta({
  label,
  icon = "Folder",
}: {
  label: string;
  icon?: IconName;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={label}>
      <Icon name={icon} className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}

export function ResourceCardStat({
  icon,
  iconClassName,
  accessibleLabel,
  children,
}: {
  icon: IconName;
  iconClassName?: string;
  accessibleLabel?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={accessibleLabel}
      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap px-1 text-muted-foreground"
    >
      <Icon
        name={icon}
        className={cn("size-3 shrink-0", iconClassName)}
        aria-hidden
      />
      <span>{children}</span>
    </span>
  );
}

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
  description?: string;
  disabled?: boolean;
}

function ResourceOptionContent({ option }: { option: ResourceOption }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-xs">{option.label}</span>
      {option.description ? (
        <span className="truncate text-2xs text-subtle-foreground">
          {option.description}
        </span>
      ) : null}
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

export type ResourceOverflowMenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: IconName;
      tone?: "default" | "destructive";
      disabled?: boolean;
      disabledReason?: string;
      onSelect: () => void;
    }
  | { kind: "separator" };

export function ResourceOverflowMenu({
  label,
  disabled = false,
  items,
}: {
  label: string;
  disabled?: boolean;
  items: readonly ResourceOverflowMenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 p-0 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
        >
          <Icon name="MoreHorizontal" className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-32 max-w-72"
        mobileTitle={label}
      >
        {items.map((item, index) => {
          if (item.kind === "separator") {
            return <DropdownMenuSeparator key={`separator-${index}`} />;
          }
          const menuItem = (
            <DropdownMenuItem
              key={item.label}
              variant={item.tone === "destructive" ? "destructive" : "default"}
              disabled={item.disabled && item.disabledReason === undefined}
              aria-disabled={item.disabled || undefined}
              className={cn(
                item.disabled && "text-muted-foreground",
                item.disabledReason !== undefined &&
                  "cursor-not-allowed focus:bg-transparent",
              )}
              onSelect={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                  return;
                }
                item.onSelect();
              }}
            >
              {item.icon ? (
                <Icon
                  name={item.icon}
                  className={cn(
                    "size-4 shrink-0",
                    item.disabled && "opacity-50",
                  )}
                  aria-hidden
                />
              ) : null}
              <span className="min-w-0 truncate">{item.label}</span>
            </DropdownMenuItem>
          );
          if (!item.disabled || item.disabledReason === undefined) {
            return menuItem;
          }
          return (
            <TooltipProvider key={item.label} delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>{menuItem}</TooltipTrigger>
                <TooltipContent side="left">
                  {item.disabledReason}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceActionButton({
  label,
  tooltipLabel,
  tooltipSide,
  icon,
  tone = "muted",
  loading = false,
  disabled = false,
  disabledReason,
  className,
  onClick,
}: {
  label: string;
  tooltipLabel?: string;
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"];
  icon: IconName;
  tone?: "muted" | "destructive";
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 p-0 text-muted-foreground hover:text-foreground",
              tone === "destructive" && "hover:text-destructive",
              disabled &&
                disabledReason !== undefined &&
                "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
              className,
            )}
            aria-label={label}
            aria-busy={loading}
            aria-disabled={disabled || undefined}
            disabled={disabled && disabledReason === undefined}
            onClick={(event) => {
              if (disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              onClick();
            }}
          >
            <Icon
              name={loading ? "Loading" : icon}
              className={cn("size-4", loading && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>
          {disabled && disabledReason
            ? disabledReason
            : (tooltipLabel ?? label)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceRow({
  leading,
  title,
  titleMeta,
  description,
  status,
  state,
  selected = false,
  muted = false,
  persistentActions,
  trailingMeta,
  actions,
  trailingVisual,
  actionsVisibility = "hover",
  className,
  openLabel,
  onOpen,
}: {
  leading?: ReactNode;
  title: ReactNode;
  /** Secondary identity metadata shown beside the title, such as an author. */
  titleMeta?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  state?: ReactNode;
  selected?: boolean;
  muted?: boolean;
  /** Controls that communicate persistent state, such as enable switches. */
  persistentActions?: ReactNode;
  /** Supporting metadata aligned with the trailing controls. */
  trailingMeta?: ReactNode;
  actions?: ReactNode;
  trailingVisual?: ReactNode;
  actionsVisibility?: "hover" | "always";
  className?: string;
  /** Accessible name for the row's primary navigation control. */
  openLabel?: string;
  onOpen: () => void;
}) {
  const rowState = state ?? status;
  const hasLeading =
    leading !== undefined && leading !== null && leading !== false;
  return (
    <div
      className={cn(
        "group grid min-w-0 cursor-pointer items-center gap-3 bg-transparent py-3 text-left focus-visible:outline-none",
        hasLeading
          ? "grid-cols-[1.5rem_minmax(0,1fr)_auto]"
          : "grid-cols-[minmax(0,1fr)_auto]",
        selected && "bg-state-active/50",
        muted && "opacity-60",
        className,
      )}
      onClick={(event) => {
        if (targetsResourceAction(event.target)) return;
        onOpen();
      }}
    >
      {hasLeading ? (
        <span className="flex size-6 shrink-0 items-center justify-center">
          {leading}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={openLabel}
        onClick={onOpen}
        className="min-w-0 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          {titleMeta ? (
            <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
              {titleMeta}
            </span>
          ) : null}
          {rowState}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </button>
      {trailingMeta || persistentActions || actions || trailingVisual ? (
        <span className="flex shrink-0 items-center gap-1">
          {trailingMeta ? (
            <span className="flex shrink-0 items-center">{trailingMeta}</span>
          ) : null}
          {actions ? (
            <span
              data-row-action
              className={cn(
                "flex shrink-0 items-center gap-0.5 transition-opacity",
                actionsVisibility === "hover" &&
                  "opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              {actions}
            </span>
          ) : null}
          {persistentActions ? (
            <span
              data-row-action
              className="flex shrink-0 items-center gap-0.5"
            >
              {persistentActions}
            </span>
          ) : null}
          {trailingVisual ? (
            <span className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md">
              {trailingVisual}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceRowDetailChevron() {
  return (
    <Icon
      name="ChevronRight"
      className="size-3.5 text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      aria-hidden
    />
  );
}

export function ResourceListPanel({
  children,
  maxHeightClassName,
  className,
}: {
  children: ReactNode;
  maxHeightClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card px-4 py-1",
        className,
      )}
    >
      <div
        className={cn(
          maxHeightClassName && "overflow-y-auto",
          maxHeightClassName,
        )}
      >
        <div className="cursor-default divide-y divide-border">{children}</div>
      </div>
    </div>
  );
}

export function ResourceListState({
  state,
  message,
  onRetry,
  loadingRows = 4,
}: {
  state: "loading" | "empty" | "error";
  message: string;
  onRetry?: () => void;
  loadingRows?: number;
}) {
  if (state === "loading") {
    return (
      <ResourceListPanel>
        <span role="status" className="sr-only">
          {message}
        </span>
        <div aria-hidden="true">
          {Array.from({ length: loadingRows }, (_, index) => (
            <div
              key={index}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 py-3"
            >
              <Skeleton className="size-6 rounded-sm" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </ResourceListPanel>
    );
  }

  return (
    <EmptyStatePanel
      role={state === "error" ? "alert" : "status"}
      className="py-6"
    >
      <div className="flex flex-col items-center gap-2">
        <span>{message}</span>
        {state === "error" && onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </EmptyStatePanel>
  );
}

export type ResourceDetailSurface = "raised" | "recessed" | "flat";

export function ResourceDetailPanel({
  children,
  className,
  surface = "raised",
}: {
  children: ReactNode;
  className?: string;
  surface?: ResourceDetailSurface;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden",
        surface === "raised" &&
          "rounded-md border border-border bg-surface-raised shadow-sm",
        surface === "recessed" &&
          "rounded-md border border-border bg-surface-recessed/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ResourcePromptContextItem {
  icon: IconName;
  label: ReactNode;
}

/**
 * Read-only preview of the saved input to an AI composer.
 *
 * The instruction stays visually connected to the context it will run with,
 * while the absence of input and send controls keeps this distinct from the
 * real editing composer.
 */
export function ResourcePromptPreview({
  children,
  className,
  context = [],
}: {
  children: ReactNode;
  className?: string;
  context?: readonly ResourcePromptContextItem[];
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface-raised-solid",
        className,
      )}
    >
      <div className="min-w-0 whitespace-pre-wrap px-3 py-3 text-sm leading-relaxed text-foreground">
        {children}
      </div>
      {context.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/35 px-3 py-2 text-xs text-muted-foreground">
          {context.map((item, index) => (
            <span
              key={index}
              className="inline-flex min-w-0 items-center gap-1.5"
            >
              <Icon
                name={item.icon}
                className="size-3.5 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 truncate">{item.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ResourceDetailList({
  children,
  className,
  surface,
}: {
  children: ReactNode;
  className?: string;
  surface?: ResourceDetailSurface;
}) {
  return (
    <ResourceDetailPanel surface={surface} className={cn("p-1", className)}>
      {children}
    </ResourceDetailPanel>
  );
}

/**
 * A quiet, divided group of peer resources within a detail section.
 *
 * Use this for files, capabilities, services, schedules, and historical
 * events. The section supplies the hierarchy; the collection supplies row
 * structure without introducing another card.
 */
export function ResourceDetailCollection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ResourceDetailList
      surface="flat"
      className={cn(
        "divide-y divide-border overflow-hidden rounded-md border border-border bg-background p-0",
        className,
      )}
    >
      {children}
    </ResourceDetailList>
  );
}

export function ResourceDetailListItem({
  leading,
  children,
  trailing,
  className,
}: {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-sm",
        className,
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
}

export function ResourceDetailActionRow({
  label,
  description,
  action,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  action: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start justify-between gap-3 text-sm",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-foreground">{label}</div>
        {description ? (
          <div className="mt-0.5 min-w-0 break-words text-xs leading-snug text-subtle-foreground/75">
            {description}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{action}</div>
    </div>
  );
}

export function ResourcePropertyList({
  children,
  className,
  surface,
}: {
  children: ReactNode;
  className?: string;
  surface?: ResourceDetailSurface;
}) {
  return (
    <ResourceDetailPanel surface={surface} className={className}>
      {children}
    </ResourceDetailPanel>
  );
}

export type ResourceDetailSectionKind =
  | "overview"
  | "definition"
  | "configuration"
  | "release"
  | "includes"
  | "activity";

export interface ResourceDetailSectionProps {
  label: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function ResourceDetailSection({
  kind = "definition",
  label,
  actions,
  children,
}: ResourceDetailSectionProps & { kind?: ResourceDetailSectionKind }) {
  return (
    <section className="space-y-3" data-resource-detail-section={kind}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{label}</h2>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One open hierarchy for a resource's semantic detail sections.
 *
 * The page is the panel. Quiet rules and shared padding separate its sections
 * without turning every section into a card. Individual content can still use
 * a recessed surface when its shape benefits from one, such as source code,
 * settings, or an error.
 */
export function ResourceDetailStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/80 [&>[data-resource-detail-section]]:py-6 [&>[data-resource-detail-section]:first-child]:pt-0 [&>[data-resource-detail-section]:last-child]:pb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Human-readable purpose and orientation. Keep this open and lightweight. */
export function ResourceDetailOverviewSection(
  props: ResourceDetailSectionProps,
) {
  return <ResourceDetailSection {...props} kind="overview" />;
}

/** The editable or inspectable primary content that defines a resource. */
export function ResourceDefinitionSection(props: ResourceDetailSectionProps) {
  return <ResourceDetailSection {...props} kind="definition" />;
}

/** Behavior-changing fields and settings. */
export function ResourceDetailConfigurationSection(
  props: ResourceDetailSectionProps,
) {
  return <ResourceDetailSection {...props} kind="configuration" />;
}

/** Version, delivery source, compatibility, and update policy. */
export function ResourceDetailReleaseSection(
  props: ResourceDetailSectionProps,
) {
  return <ResourceDetailSection {...props} kind="release" />;
}

/** Child resources and capabilities contributed by the resource. */
export function ResourceDetailIncludesSection(
  props: ResourceDetailSectionProps,
) {
  return <ResourceDetailSection {...props} kind="includes" />;
}

/** Current state and historical events produced by a resource. */
export function ResourceActivitySection(props: ResourceDetailSectionProps) {
  return <ResourceDetailSection {...props} kind="activity" />;
}

export function ResourceDetailFacts({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "divide-y divide-border overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function ResourceDetailFact({
  label,
  children,
  mono = false,
  action,
  details,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  action?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="bg-surface-recessed/55 px-3 py-2.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "min-w-0 flex-1 break-words text-sm text-foreground",
              mono && "font-mono text-xs",
            )}
          >
            {children}
          </div>
          {action ? (
            <div className="-my-1 flex shrink-0 items-center">{action}</div>
          ) : null}
        </div>
        {details ? <div className="mt-2">{details}</div> : null}
      </dd>
    </div>
  );
}

/** Passive lifecycle status for states that are observed, not changed here. */
export function ResourceLifecycleStatus({
  label,
  tooltip,
  accessibleLabel,
  icon,
  appearance = "default",
}: {
  label: ReactNode;
  tooltip?: ReactNode;
  accessibleLabel?: string;
  icon?: IconName;
  appearance?: "default" | "recessed";
}) {
  const status = (
    <span
      aria-label={accessibleLabel}
      tabIndex={tooltip === undefined ? undefined : 0}
      className={cn(
        "inline-flex h-7 min-w-20 shrink-0 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium text-muted-foreground",
        appearance === "recessed"
          ? "border-border/45 bg-surface-recessed/75 text-subtle-foreground"
          : "border-border/70 bg-transparent",
      )}
    >
      {icon ? <Icon name={icon} className="size-3.5" aria-hidden /> : null}
      {label}
    </span>
  );
  if (tooltip === undefined) return status;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{status}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Canonical action for a resource that can be added from a browse surface. */
export function ResourceInstallControl({
  accessibleLabel,
  label = "Install",
  pendingLabel = "Installing",
  pending = false,
  disabled = false,
  presentation = "label",
  tooltip,
  onAction,
}: {
  accessibleLabel: string;
  label?: string;
  pendingLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  presentation?: "label" | "icon";
  tooltip?: ReactNode;
  onAction: () => void;
}) {
  const control = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "h-7 shrink-0 justify-center text-xs",
        presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2.5",
      )}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={accessibleLabel}
      onClick={onAction}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          {presentation === "label" ? pendingLabel : null}
        </span>
      ) : (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name="Download" className="size-3.5" aria-hidden />
          {presentation === "label" ? label : null}
        </span>
      )}
    </Button>
  );
  if (presentation !== "icon" || tooltip === undefined) return control;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Canonical installed state for browse and detail surfaces.
 *
 * With an action it stays green at rest, then reveals the destructive
 * uninstall affordance only while the control itself is hovered or focused.
 */
export function ResourceInstalledControl({
  accessibleLabel,
  label = "Installed",
  actionLabel = "Uninstall",
  pendingLabel = "Uninstalling",
  pending = false,
  presentation = "label",
  tooltip,
  onAction,
}: {
  accessibleLabel: string;
  label?: string;
  actionLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  presentation?: "label" | "icon";
  tooltip?: ReactNode;
  onAction?: () => void;
}) {
  const installedContent = (
    <span className="inline-flex items-center gap-1">
      <Icon name="Check" className="size-3.5" aria-hidden />
      {presentation === "label" ? label : null}
    </span>
  );

  if (onAction === undefined) {
    const status = (
      <span
        aria-label={accessibleLabel}
        tabIndex={
          presentation === "icon" && tooltip !== undefined ? 0 : undefined
        }
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-xs font-medium text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]",
          presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2",
        )}
      >
        {installedContent}
      </span>
    );
    if (presentation !== "icon" || tooltip === undefined) return status;
    return (
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>{status}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const control = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        "group/install h-7 shrink-0 justify-center border-success/30 bg-success/10 text-xs text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))] hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text focus-visible:border-destructive/40 focus-visible:bg-destructive/10 focus-visible:text-destructive-text",
        presentation === "icon" ? "w-7 px-0" : "min-w-20 px-2",
      )}
      disabled={pending}
      aria-label={accessibleLabel}
      onClick={onAction}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          {presentation === "label" ? pendingLabel : null}
        </span>
      ) : (
        <span className="grid place-items-center">
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center transition-opacity group-hover/install:opacity-0 group-focus-visible/install:opacity-0">
            {installedContent}
          </span>
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover/install:opacity-100 group-focus-visible/install:opacity-100">
            <Icon name="Trash2" className="size-3.5" aria-hidden />
            {presentation === "label" ? actionLabel : null}
          </span>
        </span>
      )}
    </Button>
  );
  if (presentation !== "icon" || tooltip === undefined) return control;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ResourceProperty({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-foreground">{children}</div>
    </div>
  );
}

/**
 * Prompt editing treatment for resources whose stored contract is plain text.
 * It borrows the composer hierarchy without implying attachments, mentions,
 * provider controls, or a send action that the resource cannot persist.
 */
export function ResourcePromptEditor({
  value,
  ariaLabel,
  placeholder,
  hint,
  onChange,
}: {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
      <Textarea
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="min-h-52 resize-y rounded-none border-0 bg-transparent px-3.5 py-3 text-sm leading-relaxed shadow-none focus-visible:ring-0"
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <div className="flex items-center gap-1.5 bg-surface-recessed/55 px-3 py-2 text-2xs text-muted-foreground">
          <Icon name="Info" className="size-3.5" aria-hidden />
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function ResourceSection({
  label,
  count,
  leading,
  collapsed,
  onToggle,
  children,
}: {
  label: ReactNode;
  count: number;
  leading?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 bg-surface-recessed px-3 py-1.5 text-xs text-muted-foreground hover:bg-state-hover"
      >
        <Icon
          name="ChevronRight"
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
            !collapsed && "rotate-90",
          )}
          aria-hidden
        />
        {leading}
        <span className="font-medium">{label}</span>
        <span className="text-subtle-foreground">{count}</span>
      </button>
      {collapsed ? null : <div className="p-1">{children}</div>}
    </section>
  );
}

export function ResourceSectionTitle({
  className,
  ...props
}: ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "text-sm font-medium leading-5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ResourceOverview({
  description,
  browse,
  className,
  children,
}: {
  description: ReactNode;
  browse?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      <ResourceTabDescription>{description}</ResourceTabDescription>
      {browse}
      {children}
    </div>
  );
}

export interface ResourceCollectionMode<Mode extends string> {
  id: Mode;
  label: ReactNode;
  count?: number;
  accessibleLabel?: string;
}

/**
 * A resource collection with multiple projections of the same domain.
 *
 * Modes are views, not new resources: the active view owns the body and its
 * contextual actions while collection identity and description stay stable.
 */
export function ResourceCollectionPage<Mode extends string>({
  id,
  description,
  modes,
  activeMode,
  onModeChange,
  actions,
  children,
  className,
}: {
  id: string;
  description: ReactNode;
  modes: readonly ResourceCollectionMode<Mode>[];
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const activeTabId = `${id}-${activeMode}-tab`;
  const activePanelId = `${id}-${activeMode}-panel`;
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-4", className)}>
      <ResourceTabDescription>{description}</ResourceTabDescription>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" role="tablist">
          {modes.map((mode) => {
            const active = mode.id === activeMode;
            const modeIndex = modes.indexOf(mode);
            return (
              <button
                key={mode.id}
                id={`${id}-${mode.id}-tab`}
                type="button"
                role="tab"
                aria-label={mode.accessibleLabel}
                aria-selected={active}
                aria-controls={`${id}-${mode.id}-panel`}
                tabIndex={active ? 0 : -1}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onModeChange(mode.id)}
                onKeyDown={(event) => {
                  let nextIndex: number | null = null;
                  if (event.key === "ArrowRight") {
                    nextIndex = (modeIndex + 1) % modes.length;
                  } else if (event.key === "ArrowLeft") {
                    nextIndex = (modeIndex - 1 + modes.length) % modes.length;
                  } else if (event.key === "Home") {
                    nextIndex = 0;
                  } else if (event.key === "End") {
                    nextIndex = modes.length - 1;
                  }
                  if (nextIndex === null) return;
                  event.preventDefault();
                  const nextMode = modes[nextIndex];
                  if (nextMode === undefined) return;
                  onModeChange(nextMode.id);
                  document.getElementById(`${id}-${nextMode.id}-tab`)?.focus();
                }}
              >
                {mode.label}
                {mode.count !== undefined ? (
                  <span className="text-2xs text-subtle-foreground">
                    {mode.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
        className="min-h-0 flex-1 focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One bounded collection body shared by Installed and Browse projections.
 * The toolbar and pagination remain stable while this component owns the
 * collection's only scrollable region.
 */
export function ResourceCollectionViewport({
  toolbar,
  children,
  footer,
  scrollId,
  className,
  contentClassName,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  scrollId?: string;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div
      className={cn("flex h-full min-h-0 flex-col gap-3", className)}
      data-resource-collection-viewport
    >
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
      <ScrollArea
        type="scroll"
        scrollHideDelay={600}
        className="min-h-0 flex-1"
        scrollbarClassName="w-2"
        viewportProps={{
          id: scrollId,
          className: cn("overscroll-contain pr-1", contentClassName),
          "data-resource-collection-scroll": true,
        }}
      >
        {children}
      </ScrollArea>
      {footer ? (
        <div
          className="sticky bottom-0 z-10 shrink-0 border-t border-border/70 bg-background pt-3"
          data-resource-collection-footer
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function ResourceOverviewSection({
  id,
  label,
  toolbar,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  toolbar: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("space-y-2", className)}>
      <ResourceSectionTitle id={id} className="px-3">
        {label}
      </ResourceSectionTitle>
      {toolbar}
      {children}
    </section>
  );
}

/** Responsive browse projection shared by resource collection pages. */
export function ResourceBrowseGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,23rem),1fr))] gap-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ResourceBrowseSectionItem {
  id: string;
  content: ReactNode;
}

export function ResourceBrowseSection({
  icon,
  attribution,
  onBrowseAll,
  items,
  state,
}: {
  icon: IconName;
  attribution?: ReactNode;
  onBrowseAll?: () => void;
  items?: readonly ResourceBrowseSectionItem[];
  state?: ReactNode;
}) {
  const visibleItems = items ?? [];
  const shouldShowOverflowFade = visibleItems.length > 3;
  if (state === undefined && visibleItems.length === 0) return null;

  return (
    <ResourceSourceShelf
      label="Browse"
      leading={
        <Icon
          name={icon}
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      }
      attribution={attribution}
      browseAction={
        onBrowseAll ? (
          <ResourceShelfSeeAllAction type="button" onClick={onBrowseAll} />
        ) : undefined
      }
      contentMode={state === undefined ? "rail" : "panel"}
      scrollOverlay={
        state === undefined && shouldShowOverflowFade ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-[var(--resource-source-shelf-fade-ramp)] bg-gradient-to-r from-transparent to-surface-recessed-solid"
          />
        ) : undefined
      }
    >
      {state ??
        visibleItems.map((item) => (
          <ResourceSourceItem key={item.id}>{item.content}</ResourceSourceItem>
        ))}
    </ResourceSourceShelf>
  );
}

export function ResourceOverviewPage({
  description,
  browse,
  installed,
  className,
}: {
  description: ReactNode;
  browse: ComponentProps<typeof ResourceBrowseSection>;
  installed: {
    headingId: string;
    label: ReactNode;
    searchValue: string;
    searchPlaceholder: string;
    searchLabel?: string;
    onSearchChange: (value: string) => void;
    controls?: ReactNode;
    action?: ReactNode;
    body: ReactNode;
  };
  className?: string;
}) {
  return (
    <ResourceOverview
      className={className}
      description={description}
      browse={<ResourceBrowseSection {...browse} />}
    >
      <ResourceOverviewSection
        id={installed.headingId}
        label={installed.label}
        toolbar={
          <ResourceToolbar
            searchValue={installed.searchValue}
            searchPlaceholder={installed.searchPlaceholder}
            searchLabel={installed.searchLabel}
            onSearchChange={installed.onSearchChange}
            containedControls
            controls={installed.controls}
            action={installed.action}
          />
        }
      >
        {installed.body}
      </ResourceOverviewSection>
    </ResourceOverview>
  );
}

export function ResourceSourceShelf({
  label,
  attribution,
  leading,
  browseAction,
  scrollOverlay,
  contentMode = "rail",
  children,
}: {
  label: ReactNode;
  attribution?: ReactNode;
  leading?: ReactNode;
  browseAction?: ReactNode;
  scrollOverlay?: ReactNode;
  contentMode?: "rail" | "panel";
  children: ReactNode;
}) {
  return (
    <section className="w-full max-w-full space-y-[var(--resource-source-shelf-section-gap)] text-popover-foreground">
      <div className="flex min-w-0 items-center gap-[var(--resource-source-shelf-label-gap)] px-[var(--resource-source-shelf-inset)] text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-[var(--resource-source-shelf-label-gap)]">
          {leading}
          <ResourceSectionTitle className="truncate">
            {label}
          </ResourceSectionTitle>
          {attribution !== undefined &&
          attribution !== null &&
          attribution !== false ? (
            <span className="truncate text-subtle-foreground">
              {attribution}
            </span>
          ) : null}
        </div>
        {browseAction ? (
          <div className="ml-auto shrink-0 text-xs text-muted-foreground">
            {browseAction}
          </div>
        ) : null}
      </div>
      <div className="rounded-lg bg-surface-recessed/70 p-[var(--resource-source-shelf-inset)]">
        {contentMode === "panel" ? (
          children
        ) : (
          <div className="relative">
            <div className="-ml-[var(--resource-source-shelf-shadow-left-bleed)] -my-[var(--resource-source-shelf-shadow-bleed)] overflow-x-auto pl-[var(--resource-source-shelf-shadow-left-bleed)] py-[var(--resource-source-shelf-shadow-bleed)]">
              <div className="flex w-full snap-x snap-mandatory gap-[var(--resource-source-shelf-item-gap)]">
                {children}
              </div>
            </div>
            {scrollOverlay ? (
              <div className="pointer-events-none absolute inset-x-0 top-[var(--resource-source-shelf-shadow-bleed)] bottom-[var(--resource-source-shelf-shadow-bleed)]">
                {scrollOverlay}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

export function ResourceShelfAction({
  className,
  ...props
}: Omit<ButtonProps, "size" | "variant">) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto shrink-0 rounded-md px-[var(--resource-source-shelf-action-inline)] py-[var(--resource-source-shelf-action-block)] text-xs font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function ResourceShelfSeeAllAction({
  className,
  ...props
}: Omit<ButtonProps, "children" | "size" | "variant">) {
  return (
    <ResourceShelfAction className={className} {...props}>
      See all
    </ResourceShelfAction>
  );
}

export function ResourceSourceItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-[22rem] shrink-0 snap-start md:w-[var(--resource-source-shelf-item-width)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

type ResourceBrowseCardProps = {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  descriptionLines?: 2 | 3;
  byline?: ReactNode;
  headerAction?: ReactNode;
  footerMeta?: ReactNode;
} & (
  | { openLabel: string; onOpen: () => void }
  | { openLabel?: undefined; onOpen?: undefined }
);

export function ResourceBrowseCard({
  leading,
  title,
  description,
  descriptionLines = 2,
  byline,
  headerAction,
  footerMeta,
  openLabel,
  onOpen,
}: ResourceBrowseCardProps) {
  const hasLeading =
    leading !== undefined && leading !== null && leading !== false;
  return (
    <div
      className={cn(
        "group relative grid min-h-28 w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] gap-2 rounded-lg border border-border bg-card p-3 text-left",
        onOpen &&
          "transition-[border-color,box-shadow] duration-150 hover:border-foreground/20 hover:shadow-xs",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : null}
      {hasLeading ? (
        <span className="pointer-events-none relative col-start-1 row-span-2 flex min-w-0 self-center">
          <span className="flex size-6 shrink-0 items-center justify-center">
            {leading}
          </span>
          <span className="ml-3 min-w-0 flex-1">{renderIdentity()}</span>
        </span>
      ) : (
        <span className="pointer-events-none relative col-start-1 row-span-2 min-w-0 self-center">
          {renderIdentity()}
        </span>
      )}
      {headerAction ? (
        <span
          data-row-action
          className="relative col-start-2 row-start-1 flex shrink-0 items-center justify-end whitespace-nowrap"
        >
          {headerAction}
        </span>
      ) : null}
      {footerMeta ? (
        <span className="pointer-events-none relative col-start-2 row-start-2 flex items-end justify-end text-right">
          {footerMeta}
        </span>
      ) : null}
    </div>
  );

  function renderIdentity() {
    return (
      <>
        <span className="block truncate text-sm font-medium text-foreground">
          {title}
        </span>
        {description ? (
          <span
            className={cn(
              "mt-0.5 block text-left text-xs leading-snug text-muted-foreground",
              descriptionLines === 3 ? "line-clamp-3" : "line-clamp-2",
            )}
          >
            {description}
          </span>
        ) : null}
        {byline ? (
          <span className="mt-1.5 block truncate text-left text-2xs text-subtle-foreground">
            {byline}
          </span>
        ) : null}
      </>
    );
  }
}

export function ResourceTemplateBrowseCard({
  title,
  description,
  actionLabel = "Use template",
  onUse,
}: {
  title: string;
  description: ReactNode;
  actionLabel?: string;
  onUse: () => void;
}) {
  return (
    <ResourceBrowseCard
      title={title}
      description={description}
      descriptionLines={3}
      openLabel={`${actionLabel}: ${title}`}
      headerAction={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 bg-surface-recessed-soft-solid px-2 text-xs text-muted-foreground hover:bg-state-active hover:text-foreground focus-visible:bg-state-active focus-visible:text-foreground"
          onClick={onUse}
        >
          <Icon name="MessageCirclePlus" className="size-3.5" aria-hidden />
          {actionLabel}
        </Button>
      }
      onOpen={onUse}
    />
  );
}

export function ResourceDetailPage({
  title,
  titleMeta,
  leading,
  lifecycleControl,
  overflowMenu,
  actions,
  metadata,
  description,
  children,
}: {
  title: ReactNode;
  /** Passive provenance or ownership shown inline with the resource name. */
  titleMeta?: ReactNode;
  leading?: ReactNode;
  lifecycleControl?: ReactNode;
  overflowMenu?: ReactNode;
  /** Focused page actions, such as Cancel and Save in an edit route. */
  actions?: ReactNode;
  metadata?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {leading ? (
              <span className="flex size-4 shrink-0 items-center justify-center">
                {leading}
              </span>
            ) : null}
            <h1 className="min-w-0 truncate text-base font-semibold">
              {title}
            </h1>
            {titleMeta ? (
              <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
                {titleMeta}
              </span>
            ) : null}
          </div>
          {metadata ? (
            <div className="text-xs text-muted-foreground">{metadata}</div>
          ) : null}
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions || lifecycleControl || overflowMenu ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {actions ?? (
              <>
                {lifecycleControl}
                {overflowMenu}
              </>
            )}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
