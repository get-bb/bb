import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import {
  DEFAULT_SERVICE_TIER,
  type ProviderOptionDescriptor,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_SHRINK_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Popover, PopoverAnchor, PopoverContent } from "@bb/shared-ui/popover";
import { Switch } from "@bb/shared-ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@bb/shared-ui/toggle-group";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "@bb/shared-ui/menu-item-hover";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  stripModelBrandPrefix,
  type ProviderPickerOption,
} from "./model-brand-prefix";
import type { PickerOption } from "./OptionPicker";
import { PickerLoadingRows } from "./PickerLoadingRows";
import type { ModelPickerOption } from "./model-picker-option";
import {
  MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
  splitModelLabelTag,
} from "./model-picker-menu";
import {
  formatModelLoadErrorTitle,
  ModelLoadErrorMessage,
} from "./model-load-error-message";
import type { ModelNavRow } from "./ModelReasoningPicker";

export interface ModelReasoningMenuProps {
  listRef: RefObject<HTMLDivElement | null>;
  providerId: string;
  provider: ProviderPickerOption | undefined;
  providerLabel: string;
  listboxId: string | undefined;
  optionId: (index: number) => string;
  modelIsLoading: boolean;
  isShowingModelError: boolean;
  hasModelOptions: boolean;
  modelLoadError: SystemExecutionOptionsModelLoadError | null;
  modelLoadFailed: boolean;
  navRows: readonly ModelNavRow[];
  highlightedIndex: number;
  isSearching: boolean;
  showMoreModels: boolean;
  onToggleMoreModels: () => void;
  moreModelOptions: readonly ModelPickerOption[];
  moreModelsOpen: boolean;
  onMoreModelsOpenChange: (open: boolean) => void;
  isPreviewing: boolean;
  modelValue: string;
  selectionBlocked: boolean;
  onModelSelect: (model: string) => void;
  showReasoningSection: boolean;
  reasoningValue: ReasoningLevel | "";
  reasoningOptions: readonly PickerOption<ReasoningLevel>[];
  onReasoningSelect: (level: ReasoningLevel) => void;
  serviceTierOptions: readonly ProviderOptionDescriptor[];
  serviceTierValue: ServiceTier | undefined;
  onServiceTierChange: (value: ServiceTier) => void;
  onStartHandoff: (() => void) | null;
}

export function ModelReasoningMenu({
  listRef,
  providerId,
  provider,
  providerLabel,
  listboxId,
  optionId,
  modelIsLoading,
  isShowingModelError,
  hasModelOptions,
  modelLoadError,
  modelLoadFailed,
  navRows,
  highlightedIndex,
  isSearching,
  showMoreModels,
  onToggleMoreModels,
  moreModelOptions,
  moreModelsOpen,
  onMoreModelsOpenChange,
  isPreviewing,
  modelValue,
  selectionBlocked,
  onModelSelect,
  showReasoningSection,
  reasoningValue,
  reasoningOptions,
  onReasoningSelect,
  serviceTierOptions,
  serviceTierValue,
  onServiceTierChange,
  onStartHandoff,
}: ModelReasoningMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  const brandPrefix = provider?.brandPrefix;
  const singleServiceTier =
    serviceTierOptions.length === 1 ? serviceTierOptions[0] : undefined;
  const singleServiceTierText = singleServiceTier
    ? `${singleServiceTier.label} mode`
    : "";
  const selectedServiceTier = serviceTierOptions.some(
    (option) => option.id === serviceTierValue,
  )
    ? serviceTierValue
    : DEFAULT_SERVICE_TIER;
  const openSub = useCallback(() => {
    onMoreModelsOpenChange(true);
  }, [onMoreModelsOpenChange]);

  return (
    <MenuHoverProvider>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          ref={listRef}
          key={providerId || "no-provider"}
          role={listboxId ? "listbox" : undefined}
          id={listboxId}
          aria-label={listboxId ? "Models" : undefined}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1 pt-0",
            !isCompactViewport && "max-h-64",
          )}
        >
          {isShowingModelError ? null : (
            <MenuSectionLabel>Model</MenuSectionLabel>
          )}
          {modelIsLoading ? (
            <PickerLoadingRows
              label="Loading models"
              rowDataAttribute="data-model-loading-row"
            />
          ) : hasModelOptions ? (
            <>
              {navRows.map((row, index) => {
                const active = highlightedIndex === index;
                const domId = optionId(index);
                if (row.kind === "more-toggle") {
                  return (
                    <MoreModelsToggleRow
                      key="more-toggle"
                      id={domId}
                      isActive={active}
                      expanded={showMoreModels}
                      onToggle={onToggleMoreModels}
                    />
                  );
                }
                const option = row.option;
                return (
                  <MenuRowButton
                    key={option.value}
                    id={domId}
                    role={listboxId ? "option" : undefined}
                    isActive={active}
                    label={stripModelBrandPrefix(option.label, brandPrefix)}
                    qualifier={option.routeProviderId}
                    selected={!isPreviewing && option.value === modelValue}
                    disabled={selectionBlocked}
                    onClick={() => onModelSelect(option.value)}
                  />
                );
              })}
              {!isCompactViewport &&
              !isSearching &&
              moreModelOptions.length > 0 ? (
                <MoreModelsSubmenu
                  open={moreModelsOpen}
                  onOpenChange={onMoreModelsOpenChange}
                  openSub={openSub}
                  activeBrandPrefix={brandPrefix}
                  isPreviewing={isPreviewing}
                  modelValue={modelValue}
                  options={moreModelOptions}
                  onSelect={onModelSelect}
                />
              ) : null}
              {isSearching && navRows.length === 0 ? (
                <div
                  className={cn(
                    "px-2 text-xs text-muted-foreground",
                    isCompactViewport ? "py-2" : "py-[0.3125rem]",
                  )}
                >
                  No models match your search
                </div>
              ) : null}
            </>
          ) : (
            <div
              className={cn(
                "px-2 text-xs leading-relaxed text-muted-foreground",
                isCompactViewport ? "pb-3 pt-2" : "pb-2 pt-1.5",
              )}
              title={
                modelLoadError
                  ? formatModelLoadErrorTitle({
                      error: modelLoadError,
                      providerLabel,
                    })
                  : undefined
              }
            >
              {modelLoadError ? (
                <ModelLoadErrorMessage
                  error={modelLoadError}
                  providerLabel={providerLabel}
                  {...(provider?.installUrl === undefined
                    ? {}
                    : { installUrl: provider.installUrl })}
                />
              ) : modelLoadFailed ? (
                "Could not load models."
              ) : (
                "No models available"
              )}
            </div>
          )}
        </div>

        {showReasoningSection ? (
          <>
            <div className="shrink-0 border-t border-border" />
            <div className="shrink-0 px-2 py-2.5">
              <MenuSectionLabel className="mb-2 px-1 py-0">
                Reasoning
              </MenuSectionLabel>
              <ToggleGroup
                type="single"
                aria-label="Reasoning"
                value={reasoningValue}
                onValueChange={(value) => {
                  const option = reasoningOptions.find(
                    (candidate) => candidate.value === value,
                  );
                  if (option) onReasoningSelect(option.value);
                }}
                disabled={selectionBlocked}
                className="flex gap-1"
              >
                {reasoningOptions.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    className={cn(
                      "h-6 min-w-0 flex-auto shrink-0 whitespace-nowrap rounded-sm px-1 text-xs font-normal shadow-none hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:text-foreground data-[state=on]:hover:bg-state-active",
                      isCompactViewport && "h-9 text-sm",
                      LIST_HOVER_TRANSITION,
                    )}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </>
        ) : null}

        {singleServiceTier ? (
          <>
            <div className="shrink-0 border-t border-border" />
            <div className="shrink-0 p-1">
              <div
                className="flex items-center justify-between gap-3 rounded-sm px-2 py-[0.3125rem] text-xs"
                title={singleServiceTier.description}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    name="Zap"
                    className="size-4 fill-current text-muted-foreground"
                  />
                  <span>{singleServiceTierText}</span>
                </span>
                <Switch
                  checked={selectedServiceTier === singleServiceTier.id}
                  onCheckedChange={(enabled) =>
                    onServiceTierChange(
                      enabled ? singleServiceTier.id : DEFAULT_SERVICE_TIER,
                    )
                  }
                  aria-label={singleServiceTierText}
                  className={cn(LIST_HOVER_TRANSITION, "[&>span]:size-3.5")}
                />
              </div>
            </div>
          </>
        ) : serviceTierOptions.length > 1 ? (
          <>
            <div className="shrink-0 border-t border-border" />
            <div className="shrink-0 px-2 py-2.5">
              <MenuSectionLabel className="mb-2 px-1 py-0">
                Speed
              </MenuSectionLabel>
              <ToggleGroup
                type="single"
                aria-label="Speed"
                value={selectedServiceTier}
                onValueChange={(value) => {
                  if (
                    value === DEFAULT_SERVICE_TIER ||
                    serviceTierOptions.some((option) => option.id === value)
                  ) {
                    onServiceTierChange(value);
                  }
                }}
                className="flex gap-1"
              >
                {[
                  { id: DEFAULT_SERVICE_TIER, label: "Default" },
                  ...serviceTierOptions,
                ].map((option: ProviderOptionDescriptor) => (
                  <ToggleGroupItem
                    key={option.id}
                    value={option.id}
                    title={option.description}
                    className={cn(
                      "h-6 min-w-0 flex-auto shrink-0 whitespace-nowrap rounded-sm px-1 text-xs font-normal shadow-none hover:bg-state-hover hover:text-foreground data-[state=on]:bg-state-active data-[state=on]:text-foreground data-[state=on]:hover:bg-state-active",
                      isCompactViewport && "h-9 text-sm",
                      LIST_HOVER_TRANSITION,
                    )}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </>
        ) : null}

        {onStartHandoff ? (
          <>
            <div className="shrink-0 border-t border-border" />
            <div className="shrink-0 p-1">
              <MenuActionButton
                label="Handoff to new thread"
                iconName="MessageSquarePlus"
                onClick={onStartHandoff}
              />
            </div>
          </>
        ) : null}
      </div>
    </MenuHoverProvider>
  );
}

function MenuSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const isCompactViewport = useIsCompactViewport();

  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-background px-2 text-xs font-medium text-muted-foreground",
        isCompactViewport ? "pb-1.5 pt-2" : "pb-[0.3125rem] pt-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MoreModelsToggleRow({
  expanded,
  onToggle,
  isActive,
  id,
}: {
  expanded: boolean;
  onToggle: () => void;
  isActive?: boolean;
  id?: string;
}) {
  const { hoverProps } = useMenuItemHover();
  const isCompactViewport = useIsCompactViewport();
  return (
    <button
      type="button"
      id={id}
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-1 rounded-sm px-2 text-xs text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground",
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        isActive && "bg-state-active",
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
      {...hoverProps}
    >
      <span>{expanded ? "Fewer models" : "More models"}</span>
      <Icon
        name={expanded ? "ChevronUp" : "ChevronDown"}
        className="size-3.5 shrink-0"
      />
    </button>
  );
}

function MoreModelsSubmenu({
  open,
  onOpenChange,
  openSub,
  activeBrandPrefix,
  isPreviewing,
  modelValue,
  options,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openSub: () => void;
  activeBrandPrefix: string | undefined;
  isPreviewing: boolean;
  modelValue: string;
  options: readonly ModelPickerOption[];
  onSelect: (value: string) => void;
}) {
  const { isLastHovered, hoverProps } = useMenuItemHover();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const focusFirstSubItem = useCallback(() => {
    window.setTimeout(() => {
      contentRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (open && !isLastHovered) {
      onOpenChange(false);
    }
  }, [open, isLastHovered, onOpenChange]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={openSub}
          onPointerEnter={(event) => {
            hoverProps.onPointerEnter(event);
            openSub();
          }}
          onKeyDown={(event) => {
            hoverProps.onKeyDown(event);

            if (
              event.key === "Enter" ||
              event.key === " " ||
              event.key === "Spacebar" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              openSub();
              focusFirstSubItem();
              return;
            }

            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              onOpenChange(false);
            }
          }}
          className={cn(
            "relative flex w-full cursor-default select-none items-center gap-1 rounded-sm px-2 py-[0.3125rem] text-xs text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground",
            LIST_HOVER_TRANSITION,
            MENU_ITEM_LAST_HOVERED_CLASS,
          )}
          data-last-hovered={hoverProps["data-last-hovered"]}
        >
          <span>More models</span>
          <Icon name="ChevronRight" className="size-3.5 shrink-0" />
        </button>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="start"
        sideOffset={6}
        className={cn(
          "max-h-[min(20rem,var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] overflow-y-auto overscroll-contain p-1 data-[state=closed]:animate-none",
          MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "ArrowLeft") {
            event.preventDefault();
            onOpenChange(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <MenuHoverProvider>
          {options.map((option) => (
            <MenuRowButton
              key={option.value}
              label={stripModelBrandPrefix(option.label, activeBrandPrefix)}
              qualifier={option.routeProviderId}
              selected={!isPreviewing && option.value === modelValue}
              onClick={() => onSelect(option.value)}
            />
          ))}
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}

function MenuRowButton({
  label,
  qualifier,
  selected,
  disabled = false,
  onClick,
  isActive,
  id,
  role,
}: {
  label: string;
  qualifier?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  isActive?: boolean;
  id?: string;
  role?: React.AriaRole;
}) {
  const { hoverProps } = useMenuItemHover();
  const isCompactViewport = useIsCompactViewport();
  const { base, tag } = splitModelLabelTag(label);
  return (
    <button
      type="button"
      id={id}
      role={role}
      disabled={disabled}
      aria-selected={role === "option" ? Boolean(isActive) : undefined}
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 text-xs outline-none hover:bg-state-hover hover:text-foreground",
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        isActive && "bg-state-active",
        disabled && "cursor-not-allowed opacity-60",
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
      {...hoverProps}
    >
      <span
        className="truncate"
        title={qualifier ? `${label} · ${qualifier}` : label}
      >
        {base}
        {tag ? (
          <span className="ml-1.5 text-subtle-foreground">{tag}</span>
        ) : null}
        {qualifier ? (
          <span className="ml-1.5 text-subtle-foreground">{qualifier}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Icon
          name="Check"
          className={cn(
            COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
            "text-subtle-foreground",
            selected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </button>
  );
}

function MenuActionButton({
  label,
  iconName,
  onClick,
}: {
  label: string;
  iconName: IconName;
  onClick: () => void;
}) {
  const { hoverProps } = useMenuItemHover();
  const isCompactViewport = useIsCompactViewport();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none hover:bg-state-hover hover:text-foreground",
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
      {...hoverProps}
    >
      <Icon name={iconName} className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
