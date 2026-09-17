import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Input } from "@bb/shared-ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceControlButton,
  ResourceMultiSelectMenu,
  ResourceMultiSelectMenuItems,
  ResourceSortMenu,
  ResourceSortMenuItems,
  ResourceToolbar,
  type ResourceOption,
} from "@bb/shared-ui/resource-list";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import type {
  PluginBrowseSort,
  PluginBrowseCategoryOption,
  PluginBrowseSortDirection,
} from "./plugin-browse-discovery";

const PLUGIN_BROWSE_SORTS = [
  "name",
  "recently-added",
  "most-installed",
] as const satisfies readonly PluginBrowseSort[];

const PLUGIN_BROWSE_SORT_LABELS: Record<PluginBrowseSort, string> = {
  name: "Plugin name",
  "recently-added": "Recently added",
  "most-installed": "Most installed",
};

const PLUGIN_BROWSE_SORT_ICONS: Record<PluginBrowseSort, IconName> = {
  name: "Sort",
  "recently-added": "Clock",
  "most-installed": "Download",
};

export function pluginBrowseSortOptions(hasInstallCounts: boolean) {
  return PLUGIN_BROWSE_SORTS.map((sort) => ({
    id: sort,
    label: PLUGIN_BROWSE_SORT_LABELS[sort],
    leading: <Icon name={PLUGIN_BROWSE_SORT_ICONS[sort]} className="size-4" />,
    disabled: sort === "most-installed" && !hasInstallCounts,
  }));
}

export function PluginCollectionToolbar({
  query,
  selectedCategories,
  categoryOptions,
  showCategoryFilter = true,
  sort,
  sortDirection,
  installsKnown,
  changeSearchParams,
  searchPlaceholder = "Search plugins",
  action,
  sourceFilter,
  className,
}: {
  searchPlaceholder?: string;
  action?: ReactNode;
  sourceFilter?: {
    options: readonly ResourceOption[];
    selectedValues: readonly string[];
    onChange: (values: string[]) => void;
  };
  className?: string;
  query: string;
  selectedCategories: readonly string[];
  categoryOptions: readonly PluginBrowseCategoryOption[];
  showCategoryFilter?: boolean;
  sort: PluginBrowseSort | null;
  sortDirection: PluginBrowseSortDirection;
  installsKnown: boolean;
  changeSearchParams: (change: (next: URLSearchParams) => void) => void;
}) {
  const sortProps = {
    value: sort,
    direction: sortDirection,
    compact: true,
    clearInFooter: true,
    placeholderLabel: "Default",
    options: pluginBrowseSortOptions(installsKnown),
    onChange: (value: string) =>
      changeSearchParams((next) => {
        if (value === sort) {
          next.set("direction", sortDirection === "asc" ? "desc" : "asc");
        } else {
          next.set("sort", value);
          next.set("direction", value === "name" ? "asc" : "desc");
        }
      }),
    onClear: () =>
      changeSearchParams((next) => {
        next.delete("sort");
        next.delete("direction");
      }),
  };
  const categoryProps = {
    value: selectedCategories,
    options: categoryOptions,
    onChange: (values: string[]) =>
      changeSearchParams((next) => {
        next.delete("category");
        for (const value of values) next.append("category", value);
      }),
  };
  const sourceProps = sourceFilter
    ? { ...sourceFilter, label: "Source", compact: true, clearInFooter: true }
    : null;
  const controls = [
    {
      id: "sort",
      label: "Sort by",
      icon: "ArrowUpDown",
      active: sort !== null,
      content: <ResourceSortMenuItems {...sortProps} />,
    },
    ...(showCategoryFilter
      ? [
          {
            id: "category",
            label: "Category",
            icon: "SlidersHorizontal",
            active: selectedCategories.length > 0,
            content: <PluginCategoryOptions {...categoryProps} />,
          } satisfies PluginControlPage,
        ]
      : []),
    ...(sourceProps
      ? [
          {
            id: "source",
            label: "Source",
            icon: "Layers",
            active: sourceProps.selectedValues.length > 0,
            content: <ResourceMultiSelectMenuItems {...sourceProps} />,
          } satisfies PluginControlPage,
        ]
      : []),
  ] satisfies PluginControlPage[];

  return (
    <div className={cn("w-full", className)}>
      <ResourceToolbar
        compact
        action={action}
        searchValue={query}
        searchPlaceholder={searchPlaceholder}
        onSearchChange={(value) =>
          changeSearchParams((next) => {
            if (value === "") next.delete("query");
            else next.set("query", value);
          })
        }
        controls={
          <>
            <ResourceSortMenu {...sortProps} showLabel />
            {showCategoryFilter ? (
              <PluginBrowseCategoryFilter {...categoryProps} />
            ) : null}
            {sourceProps ? (
              <ResourceMultiSelectMenu
                {...sourceProps}
                icon="Layers"
                showLabel
              />
            ) : null}
          </>
        }
        combinedControls={
          controls.length > 1 ? (
            <PluginControlsMenu pages={controls} />
          ) : undefined
        }
      />
    </div>
  );
}

type PluginControlPage = {
  id: string;
  label: string;
  icon: IconName;
  active: boolean;
  content: ReactNode;
};

function PluginControlsMenu({
  pages,
}: {
  pages: readonly PluginControlPage[];
}) {
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const returnPageRef = useRef<string | null>(null);
  const page = pages.find((candidate) => candidate.id === pageId);
  const activeLabels = pages
    .filter((candidate) => candidate.active)
    .map((candidate) => candidate.label);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      if (pageId) {
        content
          ?.querySelector<HTMLElement>(
            'input, [role="menuitemradio"], [role="menuitemcheckbox"]',
          )
          ?.focus();
      } else if (returnPageRef.current) {
        content
          ?.querySelector<HTMLElement>(
            `[data-control-page="${returnPageRef.current}"]`,
          )
          ?.closest<HTMLElement>('[role="menuitem"]')
          ?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, pageId]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPageId(null);
          returnPageRef.current = null;
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <ResourceControlButton
          label="Plugin controls"
          tooltip={
            activeLabels.length
              ? `Plugin controls: ${activeLabels.join(", ")}`
              : "Plugin controls"
          }
          icon="SlidersHorizontal"
          active={activeLabels.length > 0}
          open={open}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="end"
        mobileTitle={page?.label ?? "Plugin controls"}
        className="w-72 md:p-0.5"
      >
        {page ? (
          <>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                returnPageRef.current = page.id;
                setPageId(null);
              }}
            >
              <Icon name="ArrowLeft" className="size-4" />
              Back to controls
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {page.content}
          </>
        ) : (
          pages.map((control) => (
            <DropdownMenuItem
              key={control.id}
              onSelect={(event) => {
                event.preventDefault();
                setPageId(control.id);
              }}
            >
              <Icon name={control.icon} className="size-4" />
              <span data-control-page={control.id} className="flex-1">
                {control.label}
              </span>
              {control.active ? (
                <span className="text-2xs text-muted-foreground">Active</span>
              ) : null}
              <Icon name="ChevronRight" className="size-4" />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SCROLLBAR_IDLE_DELAY_MS = 600;

function CategoryOptionCheckbox({ enabled }: { enabled: boolean }) {
  return (
    <span
      data-category-option-checkbox
      data-state={enabled ? "enabled" : "disabled"}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border shadow-xs",
        enabled
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background text-transparent",
      )}
      aria-hidden
    >
      <Icon name="Check" className="size-3.5" />
    </span>
  );
}

type PluginCategoryFilterProps = {
  options: readonly PluginBrowseCategoryOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
};

export function PluginBrowseCategoryFilter(props: PluginCategoryFilterProps) {
  const { options, value } = props;
  const [open, setOpen] = useState(false);
  const selectedOptions = value.flatMap((selectedId) => {
    const option = options.find((candidate) => candidate.id === selectedId);
    return option === undefined ? [] : [option];
  });
  const accessibleSelectionLabel =
    selectedOptions.length === 0
      ? "All categories"
      : selectedOptions.map((option) => option.label).join(", ");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceControlButton
          label={`Filter plugins by category: ${accessibleSelectionLabel}`}
          text="Category"
          tooltip={`Category: ${accessibleSelectionLabel}`}
          icon="SlidersHorizontal"
          active={value.length > 0}
          open={open}
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        mobileTitle="Filter plugins by category"
        className="w-72 p-1.5 md:p-0.5"
      >
        {open ? <PluginCategoryOptions {...props} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function PluginCategoryOptions({
  options,
  value,
  onChange,
}: PluginCategoryFilterProps) {
  const [search, setSearch] = useState("");
  const [showKeyboardFocus, setShowKeyboardFocus] = useState(false);
  const [scrollbarScrolling, setScrollbarScrolling] = useState(false);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardFocusRef = useRef(false);
  const selected = new Set(value);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.id}`
      .toLocaleLowerCase()
      .includes(normalizedSearch),
  );
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const {
    scrollRef: listRef,
    topSentinelRef,
    bottomSentinelRef,
    belowOverflow,
  } = useScrollOverflowState<HTMLDivElement>({
    enabled: listElement !== null,
    measureOverflow: true,
  });
  const attachList = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      setListElement(node);
    },
    [listRef],
  );
  const scrollbarIdleRef = useRef<number | null>(null);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() =>
      inputRef.current?.focus(),
    );
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(
    () => () => {
      if (scrollbarIdleRef.current !== null) {
        window.clearTimeout(scrollbarIdleRef.current);
      }
    },
    [],
  );

  const revealScrollbarWhileScrolling = (
    _event: React.UIEvent<HTMLDivElement>,
  ) => {
    setScrollbarScrolling(true);
    if (scrollbarIdleRef.current !== null) {
      window.clearTimeout(scrollbarIdleRef.current);
    }
    scrollbarIdleRef.current = window.setTimeout(() => {
      scrollbarIdleRef.current = null;
      setScrollbarScrolling(false);
    }, SCROLLBAR_IDLE_DELAY_MS);
  };

  const clearSelection = () => {
    onChange([]);
  };

  const toggle = (optionId: string) => {
    const next = new Set(value);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    onChange([...next]);
  };

  return (
    <>
      <div className="relative mx-2.5 mt-1.5">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search categories"
          aria-label="Search plugin categories"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={true}
          aria-autocomplete="list"
          className={cn(
            "h-7 border-transparent bg-surface-recessed pl-7 pr-2 text-xs focus-visible:ring-0",
            showKeyboardFocus && "ring-1 ring-ring",
          )}
          onFocus={() => setShowKeyboardFocus(keyboardFocusRef.current)}
          onBlur={() => setShowKeyboardFocus(false)}
          onPointerDown={() => {
            keyboardFocusRef.current = false;
            setShowKeyboardFocus(false);
          }}
          onKeyDown={(event) => {
            keyboardFocusRef.current = true;
            setShowKeyboardFocus(true);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              categoryOptionElements(listElement)[0]?.focus();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              event.stopPropagation();
              categoryOptionElements(listElement).at(-1)?.focus();
            } else if (event.key !== "Escape" && event.key !== "Tab") {
              event.stopPropagation();
            }
          }}
        />
      </div>
      <div className="relative isolate mt-1.5">
        <div
          id={listboxId}
          ref={attachList}
          data-scrollbar-scrolling={scrollbarScrolling ? "true" : undefined}
          role="listbox"
          aria-label="Plugin categories"
          aria-multiselectable={true}
          className="transient-scrollbar max-h-64 overflow-y-auto"
          onScroll={revealScrollbarWhileScrolling}
        >
          <div ref={topSentinelRef} aria-hidden className="h-px w-full" />
          {filteredOptions.length === 0 ? (
            <p
              className="px-2 py-6 text-center text-xs text-muted-foreground"
              role="status"
            >
              {options.length === 0
                ? "No categories are available."
                : "No categories match your search."}
            </p>
          ) : (
            filteredOptions.map((option) => {
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-label={`${option.label}, ${option.count.toLocaleString()} ${option.count === 1 ? "plugin" : "plugins"}`}
                  aria-selected={selected.has(option.id)}
                  onClick={() => toggle(option.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs outline-none hover:bg-state-hover focus-visible:bg-state-hover focus-visible:text-foreground md:gap-1.5"
                  onKeyDown={(event) => focusCategoryOption(event, listElement)}
                >
                  <span className="flex w-8 shrink-0 justify-center">
                    <span
                      data-category-option-count
                      className="rounded-full bg-surface-recessed p-1.5 text-center text-2xs font-medium leading-none tabular-nums text-subtle-foreground"
                    >
                      {option.count.toLocaleString()}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {option.label}
                  </span>
                  <CategoryOptionCheckbox enabled={selected.has(option.id)} />
                </button>
              );
            })
          )}
          <div ref={bottomSentinelRef} aria-hidden className="h-px w-full" />
        </div>
        {belowOverflow ? (
          <div
            aria-hidden
            data-category-list-fade="below"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-popover/90 via-popover/60 to-transparent"
          />
        ) : null}
      </div>
      <div className="mt-0.5 border-t border-border-seam pt-0.5">
        <button
          type="button"
          disabled={value.length === 0}
          onClick={clearSelection}
          className="flex w-full items-center rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          Clear filter
        </button>
      </div>
    </>
  );
}

function focusCategoryOption(
  event: React.KeyboardEvent<HTMLButtonElement>,
  listbox: HTMLDivElement | null,
) {
  const options = categoryOptionElements(listbox);
  const index = options.indexOf(event.currentTarget);
  if (index < 0) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown")
    nextIndex = Math.min(index + 1, options.length - 1);
  else if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  event.stopPropagation();
  options[nextIndex]?.focus();
}

function categoryOptionElements(
  listbox: HTMLDivElement | null,
): HTMLButtonElement[] {
  if (listbox === null) return [];
  return [...listbox.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}
