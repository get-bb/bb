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
  combinedControls,
  action,
  compact = false,
  expandSearchOnFocus = false,
}: {
  searchValue: string;
  searchPlaceholder: string;
  searchLabel?: string;
  onSearchChange: (value: string) => void;
  controls?: ReactNode;
  combinedControls?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  expandSearchOnFocus?: boolean;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const individualControlsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const [combined, setCombined] = useState(false);
  const [searchCondensed, setSearchCondensed] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const restoreControlFocus = useRef(false);
  const combinedRef = useRef(false);
  const hasCombinedControls = Boolean(combinedControls);
  const showCombined = compact && hasCombinedControls && combined;
  const showSearchButton = searchCondensed && !searchExpanded;

  const collapseSearch = () => {
    restoreSearchFocus.current = searchCondensed;
    searchInputRef.current?.blur();
    setSearchExpanded(false);
  };

  useLayoutEffect(() => {
    if (searchExpanded) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    } else if (restoreSearchFocus.current) {
      searchButtonRef.current?.focus();
      restoreSearchFocus.current = false;
    }
  }, [searchExpanded]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const individualControls = individualControlsRef.current;
    const search = searchRef.current;
    if (!toolbar || !individualControls || !search || !compact) return;
    let previousWidth = 0;
    const measure = () => {
      const width = toolbar.getBoundingClientRect().width;
      if (width === 0) return;
      const widthChanged = previousWidth !== width;
      previousWidth = width;
      if (
        !widthChanged &&
        controlsRef.current?.querySelector('[aria-haspopup][data-state="open"]')
      )
        return;
      const gap = Number.parseFloat(getComputedStyle(toolbar).columnGap) || 0;
      const searchWidth = Number.parseFloat(getComputedStyle(search).flexBasis);
      const actionWidth = actionRef.current?.getBoundingClientRect().width ?? 0;
      const requiredWidth =
        searchWidth +
        individualControls.getBoundingClientRect().width +
        actionWidth +
        gap * (actionRef.current ? 2 : 1);
      const next = hasCombinedControls && width < requiredWidth;
      const controlsWidth = next
        ? (controlsRef.current
            ?.querySelector("[data-resource-combined-controls]")
            ?.getBoundingClientRect().width ?? 0)
        : individualControls.getBoundingClientRect().width;
      setSearchCondensed(
        expandSearchOnFocus &&
          width -
            controlsWidth -
            actionWidth -
            gap * (actionRef.current ? 2 : 1) <
            searchWidth,
      );
      if (combinedRef.current === next) return;
      restoreControlFocus.current = Boolean(
        controlsRef.current?.contains(document.activeElement) ||
        controlsRef.current?.querySelector('[data-state="open"]'),
      );
      combinedRef.current = next;
      setCombined(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(individualControls);
    if (controlsRef.current) observer.observe(controlsRef.current);
    if (actionRef.current) observer.observe(actionRef.current);
    let frame = 0;
    const menuObserver = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    if (controlsRef.current)
      menuObserver.observe(controlsRef.current, {
        attributes: true,
        attributeFilter: ["data-state"],
        subtree: true,
      });
    return () => {
      observer.disconnect();
      menuObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [
    compact,
    expandSearchOnFocus,
    hasCombinedControls,
    showCombined,
  ]);

  useLayoutEffect(() => {
    if (!restoreControlFocus.current) return;
    controlsRef.current
      ?.querySelector<HTMLButtonElement>(
        showCombined ? "[data-resource-combined-controls] button" : "button",
      )
      ?.focus();
    restoreControlFocus.current = false;
  }, [showCombined]);

  return (
    <div
      ref={toolbarRef}
      data-resource-toolbar
      data-search-expanded={searchExpanded || undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-2",
        compact
          ? "@container/resource-toolbar flex-nowrap max-md:gap-1"
          : "flex-wrap",
      )}
    >
      <form
        ref={searchRef}
        role="search"
        aria-label={searchLabel ?? searchPlaceholder}
        onSubmit={(event) => {
          event.preventDefault();
          if (searchExpanded) collapseSearch();
          else searchInputRef.current?.focus();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setSearchExpanded(false);
        }}
        className={cn(
          "flex items-center gap-2",
          compact
            ? "min-w-0 flex-1 basis-40"
            : "w-full min-w-0 sm:w-auto sm:flex-1",
          showSearchButton && "min-w-8",
        )}
      >
        {showSearchButton ? (
          <ResourceControlButton
            ref={searchButtonRef}
            label={searchLabel ?? searchPlaceholder}
            tooltip={searchValue ? `Search: ${searchValue}` : searchPlaceholder}
            icon="Search"
            active={searchValue !== ""}
            className="w-full"
            onClick={() => setSearchExpanded(true)}
          />
        ) : (
          <div className="relative min-w-0 flex-1">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchLabel ?? searchPlaceholder}
              enterKeyHint={expandSearchOnFocus ? "search" : undefined}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                } else if (event.key === "Escape" && searchExpanded) {
                  event.preventDefault();
                  collapseSearch();
                }
              }}
              className={cn(
                "h-8 truncate pl-8 focus:border-ring/60 focus:text-clip focus:ring-2 focus:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring/20 max-md:pointer-coarse:h-8",
                expandSearchOnFocus && "text-xs max-md:pointer-coarse:text-xs",
                (searchExpanded || (!searchCondensed && searchValue)) && "pr-8",
              )}
            />
            {searchExpanded || (!searchCondensed && searchValue) ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Clear search"
                      className="absolute inset-y-0 right-0 size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        onSearchChange("");
                        collapseSearch();
                      }}
                    >
                      <Icon name="X" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        )}
      </form>
      {controls ? (
        <div
          ref={controlsRef}
          inert={searchExpanded || undefined}
          aria-hidden={searchExpanded || undefined}
          className={cn(
            "flex shrink-0 items-center",
            compact ? "gap-2" : "gap-1.5",
            searchExpanded && "invisible absolute pointer-events-none",
          )}
        >
          <div
            className={
              showCombined ? "absolute size-0 overflow-hidden" : undefined
            }
            aria-hidden={showCombined || undefined}
            inert={showCombined || undefined}
          >
            <div
              key={showCombined ? "measuring" : "visible"}
              ref={individualControlsRef}
              data-resource-individual-controls
              className={cn(
                "flex w-max items-center",
                compact ? "gap-2" : "gap-1.5",
              )}
            >
              {controls}
            </div>
          </div>
          {showCombined ? (
            <div data-resource-combined-controls>
              {combinedControls}
            </div>
          ) : null}
        </div>
      ) : null}
      {action ? (
        <div
          ref={actionRef}
          data-resource-toolbar-action
          inert={searchExpanded || undefined}
          aria-hidden={searchExpanded || undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5",
            !compact && "ml-auto",
            searchExpanded && "invisible absolute pointer-events-none",
          )}
        >
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
    icon?: IconName;
    active?: boolean;
    open?: boolean;
    tooltip?: ReactNode;
    text?: string;
    count?: number;
    trailingIcon?: IconName;
  }
>(function ResourceControlButton(
  {
    label,
    icon,
    active = false,
    open = false,
    tooltip = label,
    text,
    count,
    trailingIcon,
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
            size={text ? "sm" : "icon"}
            className={cn(
              "h-8 shrink-0 rounded-md text-muted-foreground",
              text
                ? "gap-2 px-2 text-xs @max-[19rem]/resource-toolbar:gap-1 @max-[19rem]/resource-toolbar:px-1"
                : "size-8 p-0",
              RESOURCE_MENU_TRIGGER_RESTING_CLASS,
              (open || active) && RESOURCE_MENU_TRIGGER_ENGAGED_CLASS,
              className,
            )}
            aria-label={label}
          >
            {icon ? <Icon name={icon} className="size-4" aria-hidden /> : null}
            {text ? <span>{text}</span> : null}
            {count !== undefined && count > 0 ? (
              <span
                aria-hidden
                className="rounded bg-surface-recessed px-1 text-2xs"
              >
                {count}
              </span>
            ) : null}
            {trailingIcon ? (
              <Icon name={trailingIcon} className="size-4" aria-hidden />
            ) : null}
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
  showHeading = true,
}: {
  label: string;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
  compact?: boolean;
  clearInFooter?: boolean;
  showHeading?: boolean;
}) {
  const selected = new Set(selectedValues);
  function updateValue(option: ResourceOption, checked: boolean) {
    const next = nextSelectedValues(option, checked, selectedValues);
    if (next !== null) onChange(next);
  }
  return (
    <>
      {showHeading ? (
        <DropdownMenuLabel
          className={cn(
            "text-xs font-normal text-subtle-foreground",
            compact && "md:px-1.5 md:py-1",
          )}
        >
          {label}
        </DropdownMenuLabel>
      ) : null}
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
  showLabel = false,
  showHeading = true,
}: {
  label: string;
  icon?: IconName;
  selectedValues: readonly string[];
  options: readonly ResourceOption[];
  onChange: (values: string[]) => void;
  compact?: boolean;
  clearInFooter?: boolean;
  showLabel?: boolean;
  showHeading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedValues);
  const activeOptions = options.filter((option) => selected.has(option.id));
  const activeSelectedCount = activeOptions.length;
  const selectionSummary =
    activeSelectedCount === 0
      ? "All"
      : activeOptions.map((option) => option.label).join(", ");
  const triggerLabel =
    activeSelectedCount === 0
      ? label
      : `${label}: ${activeSelectedCount} selected`;
  const triggerTooltip = `${label}: ${selectionSummary}`;

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <ResourceMenuTrigger
        label={triggerLabel}
        text={showLabel ? label : undefined}
        icon={icon}
        trailingIcon={showLabel ? "ChevronDown" : undefined}
        count={showLabel ? activeSelectedCount : undefined}
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
          showHeading={showHeading}
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
  showHeading = true,
}: {
  value: string | null;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholderLabel?: string;
  compact?: boolean;
  clearInFooter?: boolean;
  showHeading?: boolean;
}) {
  return (
    <>
      {showHeading ? (
        <DropdownMenuLabel
          className={cn(
            "text-xs font-normal text-subtle-foreground",
            compact && "md:px-1.5 md:py-1",
          )}
        >
          Sort
        </DropdownMenuLabel>
      ) : null}
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
  showLabel = false,
  triggerIcon = "ArrowUpDown",
  showHeading = true,
  tooltip,
}: {
  value: string | null;
  direction: "asc" | "desc";
  options: readonly ResourceOption[];
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholderLabel?: string;
  compact?: boolean;
  clearInFooter?: boolean;
  showLabel?: boolean;
  triggerIcon?: IconName;
  showHeading?: boolean;
  tooltip?: string;
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
        text={showLabel ? (selectedOption?.label ?? "Sort") : undefined}
        icon={triggerIcon}
        trailingIcon={showLabel ? "ChevronDown" : undefined}
        tooltip={tooltip ?? sortStateLabel}
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
          showHeading={showHeading}
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
        compactWhenNarrow &&
          "pl-2 pr-1 @max-[19rem]/resource-toolbar:gap-1 @max-[19rem]/resource-toolbar:px-1",
      )}
      onClick={() => onCreate()}
    >
      <Icon name="MessageCirclePlus" className="size-4" aria-hidden />
      <span>{label}</span>
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
            className={cn(
              "rounded-l-none px-1.5",
              compactWhenNarrow &&
                "pl-1 pr-2 @max-[19rem]/resource-toolbar:px-1",
            )}
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
