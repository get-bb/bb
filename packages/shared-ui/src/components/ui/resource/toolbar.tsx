import {
  Fragment,
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, type ButtonProps } from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  overflowControls,
  action,
  compact = false,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchLabel?: string;
  onSearchChange: (value: string) => void;
  controls?: ReactNode;
  overflowControls?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const restoreControlFocus = useRef(false);
  const overflowRef = useRef(false);
  const hasOverflowControls = Boolean(overflowControls);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !compact || !hasOverflowControls) return;
    const measure = () => {
      const width = toolbar.getBoundingClientRect().width;
      if (width === 0) return;
      const next = width < 384;
      if (overflowRef.current === next) return;
      restoreControlFocus.current = Boolean(
        controlsRef.current?.contains(document.activeElement) ||
        controlsRef.current?.querySelector('[data-state="open"]'),
      );
      overflowRef.current = next;
      setOverflow(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [compact, hasOverflowControls]);

  useLayoutEffect(() => {
    if (!restoreControlFocus.current) return;
    controlsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    restoreControlFocus.current = false;
  }, [overflow]);

  return (
    <div
      ref={toolbarRef}
      data-resource-toolbar
      className={cn(
        "flex items-center gap-2",
        compact ? "@container/resource-toolbar flex-nowrap" : "flex-wrap",
      )}
    >
      <div
        className={cn(
          "relative",
          compact
            ? "min-w-0 max-w-64 flex-[1_1_16rem]"
            : "w-full min-w-0 sm:w-auto sm:flex-1",
        )}
      >
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
        <div ref={controlsRef} className="flex shrink-0 items-center gap-2">
          {overflow && overflowControls ? overflowControls : controls}
        </div>
      ) : null}
      {action ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function ResourceTabDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-5 text-muted-foreground">{children}</p>;
}

export interface ResourceOption {
  id: string;
  label: string;
  leading?: ReactNode;
  description?: string;
  disabled?: boolean;
  omitDirection?: boolean;
}

function ResourceOptionContent({
  option,
  compact = false,
}: {
  option: ResourceOption;
  compact?: boolean;
}) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-2", compact && "md:gap-1.5")}
    >
      {option.leading ? (
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {option.leading}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span
          className="truncate text-xs"
          title={compact ? option.label : undefined}
        >
          {option.label}
        </span>
        {option.description ? (
          <span className="truncate text-2xs text-subtle-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </span>
  );
}

const RESOURCE_MENU_TRIGGER_ENGAGED_CLASS =
  "bg-state-active text-foreground hover:bg-state-active";

const RESOURCE_MENU_TRIGGER_RESTING_CLASS = "border border-input bg-background";

export const ResourceControlButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & {
    label: string;
    icon: IconName;
    active?: boolean;
    open?: boolean;
    tooltip?: ReactNode;
  }
>(function ResourceControlButton(
  {
    label,
    icon,
    active = false,
    open = false,
    tooltip = label,
    className,
    ...props
  },
  ref,
) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            ref={ref}
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "size-8 shrink-0 rounded-md p-0 text-muted-foreground",
              RESOURCE_MENU_TRIGGER_RESTING_CLASS,
              (open || active) && RESOURCE_MENU_TRIGGER_ENGAGED_CLASS,
              className,
            )}
            aria-label={label}
          >
            <Icon name={icon} className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

function ResourceMenuTrigger(
  props: React.ComponentProps<typeof ResourceControlButton>,
) {
  return (
    <DropdownMenuTrigger asChild>
      <ResourceControlButton {...props} />
    </DropdownMenuTrigger>
  );
}

function nextSelectedValues(
  option: ResourceOption,
  checked: boolean,
  selectedValues: readonly string[],
): string[] | null {
  if (option.disabled) return null;
  const next = new Set(selectedValues);
  if (checked) {
    next.add(option.id);
  } else {
    next.delete(option.id);
  }
  return [...next];
}

export function ResourceMultiSelectMenuItems({
  label,
  selectedValues,
  options,
  onChange,
  compact = false,
  clearInFooter = false,
}: {
  label: string;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
  compact?: boolean;
  clearInFooter?: boolean;
}) {
  const selected = new Set(selectedValues);
  function updateValue(option: ResourceOption, checked: boolean) {
    const next = nextSelectedValues(option, checked, selectedValues);
    if (next !== null) onChange(next);
  }
  return (
    <>
      <DropdownMenuLabel
        className={cn(
          "text-xs font-normal text-subtle-foreground",
          compact && "md:px-1.5 md:py-1",
        )}
      >
        {label}
      </DropdownMenuLabel>
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.id}
          checked={selected.has(option.id)}
          disabled={option.disabled}
          className={cn(compact && "md:py-1 md:pl-1.5 md:pr-7")}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => updateValue(option, checked === true)}
        >
          <ResourceOptionContent option={option} compact={compact} />
        </DropdownMenuCheckboxItem>
      ))}
      {clearInFooter ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={selectedValues.length === 0}
            onSelect={(event) => {
              event.preventDefault();
              onChange([]);
            }}
            className={cn(
              "text-xs text-muted-foreground",
              compact && "md:px-1.5 md:py-1",
            )}
          >
            Clear filter
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

export function ResourceMultiSelectMenu({
  label,
  icon,
  selectedValues,
  options,
  onChange,
  compact = false,
  clearInFooter = false,
}: {
  label: string;
  icon: IconName;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
  compact?: boolean;
  clearInFooter?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedValues);
  const activeOptions = options.filter((option) => selected.has(option.id));
  const activeSelectedCount = activeOptions.length;
  const selectionSummary =
    activeSelectedCount === 0 ? "All" : `${activeSelectedCount} selected`;
  const triggerLabel =
    activeSelectedCount === 0
      ? label
      : `${label}: ${activeSelectedCount} selected`;
  const triggerTooltip = `${label}: ${selectionSummary}`;

  function updateValue(option: ResourceOption, checked: boolean) {
    const next = nextSelectedValues(option, checked, selectedValues);
    if (next === null) return;
    onChange(next);
  }

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon={icon}
        active={activeSelectedCount > 0}
        open={open}
        tooltip={triggerTooltip}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle={label}
        className={cn(compact ? "w-max max-w-64 md:p-0.5" : "min-w-44")}
      >
        <ResourceMultiSelectMenuItems
          label={label}
          selectedValues={selectedValues}
          options={options}
          onChange={onChange}
          compact={compact}
          clearInFooter={clearInFooter}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ResourceFilterGroup {
  id: string;
  label: string;
  options: readonly ResourceOption[];
  selectedValues: readonly string[];
  onChange: (values: string[]) => void;
}

export function ResourceFilterMenu({
  groups,
  compact = false,
}: {
  groups: readonly ResourceFilterGroup[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const renderedGroups = groups
    .filter((group) => group.options.length > 0)
    .map((group) => {
      const selected = new Set(group.selectedValues);
      const activeOptions = group.options.filter((option) =>
        selected.has(option.id),
      );
      return { group, selected, activeOptions };
    });
  const activeSummaries = renderedGroups
    .filter(({ activeOptions }) => activeOptions.length > 0)
    .map(
      ({ group, activeOptions }) =>
        `${group.label}: ${activeOptions.map((option) => option.label).join(", ")}`,
    );
  const hasActiveFilter = activeSummaries.length > 0;
  const triggerLabel = hasActiveFilter
    ? `Filters: ${activeSummaries.join("; ")}`
    : "Filters";

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={triggerLabel}
        icon="SlidersHorizontal"
        active={hasActiveFilter}
        open={open}
        tooltip={hasActiveFilter ? activeSummaries.join("; ") : "Filters: All"}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle="Filters"
        className={cn(compact ? "w-max max-w-64 md:p-0.5" : "min-w-44")}
      >
        {renderedGroups.map(({ group, selected }, groupIndex) => (
          <Fragment key={group.id}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup aria-label={group.label}>
              <DropdownMenuLabel
                className={cn(
                  "text-xs font-normal text-subtle-foreground",
                  compact && "md:px-1.5 md:py-1",
                )}
              >
                {group.label}
              </DropdownMenuLabel>
              {group.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.id}
                  checked={selected.has(option.id)}
                  disabled={option.disabled}
                  className={cn(compact && "md:py-1 md:pl-1.5 md:pr-7")}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => {
                    const next = nextSelectedValues(
                      option,
                      checked === true,
                      group.selectedValues,
                    );
                    if (next === null) return;
                    group.onChange(next);
                  }}
                >
                  <ResourceOptionContent option={option} compact={compact} />
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResourceSortMenuItems({
  value,
  direction,
  options,
  onChange,
  onClear,
  placeholderLabel = "Sort",
  compact = false,
  clearInFooter = false,
}: {
  value: string | null;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholderLabel?: string;
  compact?: boolean;
  clearInFooter?: boolean;
}) {
  return (
    <>
      <DropdownMenuLabel
        className={cn(
          "text-xs font-normal text-subtle-foreground",
          compact && "md:px-1.5 md:py-1",
        )}
      >
        Sort by
      </DropdownMenuLabel>
      {onClear === undefined || clearInFooter ? null : (
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={value === null}
          onSelect={(event) => {
            event.preventDefault();
            onClear();
          }}
          className={cn(
            "flex items-center justify-between gap-3",
            compact && "md:gap-2 md:px-1.5 md:py-1",
          )}
        >
          {placeholderLabel}
          <Icon
            name="Check"
            aria-hidden
            className={cn(
              "size-4 text-subtle-foreground",
              value === null ? "opacity-100" : "opacity-0",
            )}
          />
        </DropdownMenuItem>
      )}
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <DropdownMenuItem
            key={option.id}
            disabled={option.disabled}
            role="menuitemradio"
            aria-checked={selected}
            onSelect={(event) => {
              event.preventDefault();
              if (option.disabled) return;
              onChange(option.id);
            }}
            className={cn(
              "flex items-center justify-between gap-3",
              compact && "md:gap-2 md:px-1.5 md:py-1",
            )}
          >
            <ResourceOptionContent option={option} compact={compact} />
            <Icon
              name={direction === "asc" ? "ArrowUp" : "ArrowDown"}
              aria-hidden
              className={cn(
                "size-4 text-subtle-foreground",
                option.omitDirection === true
                  ? "hidden"
                  : selected
                    ? "opacity-100"
                    : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        );
      })}
      {clearInFooter && onClear !== undefined ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={value === null}
            onSelect={(event) => {
              event.preventDefault();
              onClear();
            }}
            className={cn(
              "text-xs text-muted-foreground",
              compact && "md:px-1.5 md:py-1",
            )}
          >
            Clear sort
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

export function ResourceSortMenu({
  value,
  direction,
  options,
  onChange,
  onClear,
  placeholderLabel = "Sort",
  compact = false,
  clearInFooter = false,
}: {
  value: string | null;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholderLabel?: string;
  compact?: boolean;
  clearInFooter?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.id === value);
  const directionLabel = direction === "asc" ? "ascending" : "descending";
  const sortStateLabel =
    selectedOption === undefined
      ? `Sort: ${placeholderLabel}`
      : selectedOption.omitDirection === true
        ? `Sort: ${selectedOption.label}`
        : `Sort: ${selectedOption.label}, ${directionLabel}`;

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={sortStateLabel}
        icon="ArrowUpDown"
        active={onClear !== undefined && value !== null}
        open={open}
      />
      <DropdownMenuContent
        align="end"
        mobileTitle="Sort"
        className={cn("min-w-40", compact && "md:p-0.5")}
      >
        <ResourceSortMenuItems
          value={value}
          direction={direction}
          options={options}
          onChange={onChange}
          onClear={onClear}
          placeholderLabel={placeholderLabel}
          compact={compact}
          clearInFooter={clearInFooter}
        />
      </DropdownMenuContent>
    </DropdownMenu>
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

export interface ResourceCreateTemplateGroup {
  label: string;
  templates: readonly ResourceCreateTemplate[];
}

export function ResourceCreateButton({
  label,
  templates,
  templateGroups,
  menuActions = [],
  onCreate,
  compactWhenNarrow = false,
}: {
  label: string;
  templates: readonly ResourceCreateTemplate[];
  templateGroups?: readonly ResourceCreateTemplateGroup[];
  menuActions?: readonly ResourceCreateMenuAction[];
  onCreate: (prompt?: string) => void;
  compactWhenNarrow?: boolean;
}) {
  const groups: readonly ResourceCreateTemplateGroup[] = templateGroups ?? [
    { label: "Examples", templates },
  ];
  const createButton = (
    <Button
      aria-label={label}
      type="button"
      size="sm"
      className={cn(
        "rounded-r-none",
        compactWhenNarrow && "@max-[36rem]/resource-toolbar:px-2",
      )}
      onClick={() => onCreate()}
    >
      <Icon name="MessageCirclePlus" className="size-4" aria-hidden />
      <span
        className={cn(
          compactWhenNarrow && "@max-[36rem]/resource-toolbar:hidden",
        )}
      >
        {label}
      </span>
    </Button>
  );
  return (
    <div className="flex shrink-0 items-stretch">
      {compactWhenNarrow ? (
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <TooltipTrigger asChild>{createButton}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        createButton
      )}
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
          mobileTitle="Examples"
        >
          {menuActions.map((action) => (
            <DropdownMenuItem key={action.label} onSelect={action.onSelect}>
              <Icon name={action.icon} className="size-4" aria-hidden />
              {action.label}
            </DropdownMenuItem>
          ))}
          {groups.map((group, index) => (
            <Fragment key={group.label}>
              {index > 0 || menuActions.length > 0 ? (
                <DropdownMenuSeparator />
              ) : null}
              <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">
                {group.label}
              </DropdownMenuLabel>
              {group.templates.map((template) => (
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
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
