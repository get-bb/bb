import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import type { ReasoningLevel } from "@bb/domain";
import { stripModelBrandPrefix } from "./model-brand-prefix";
import { REASONING_LABELS } from "@/lib/reasoning-labels";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { Switch } from "@bb/shared-ui/switch";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "@bb/shared-ui/menu-item-hover";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
  type PickerOption,
} from "./OptionPicker";
import {
  formatModelLoadErrorText,
  ModelLoadErrorMessage,
} from "./model-load-error-message";

interface ModelLabelParts {
  base: string;
  tag: string | null;
}

const FAILED_TO_LOAD_MODELS_LABEL = "Failed to load models";

// Below this many models (primary + selected-only) the list is short enough to
// scan by eye, so the search box is more clutter than help.
const MODEL_SEARCH_MIN_OPTIONS = 5;

// Splits a trailing parenthetical off a model label (e.g. "Opus 4.8 (1M)" →
// base "Opus 4.8", tag "1M") so the tag can render as a small, muted suffix
// without the parentheses. Labels without a trailing "(…)" pass through
// unchanged (tag null).
function splitModelLabelTag(label: string): ModelLabelParts {
  const match = label.match(/^(.*\S)\s*\(([^()]+)\)$/u);
  if (!match) {
    return { base: label, tag: null };
  }
  return { base: match[1], tag: match[2] };
}

/**
 * Build a loose fuzzy RegExp from a plain-text query.
 * Each character is matched in order with `.*` between them, so
 * "gpt4" matches "GPT-4 Turbo".
 */
export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

// Filter options by fuzzy-matching against text the caller derives from each
// option. Pass the *rendered* text (see `modelSearchText`) so search matches
// what the user actually sees on screen.
function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string,
): readonly T[] {
  if (!normalizedQuery) return options;
  const regex = buildFuzzyRegex(normalizedQuery);
  return options.filter((option) => regex.test(getText(option)));
}

// The text a model row is matched against: the visible (brand-stripped) label
// plus the raw model id, so typing either the on-screen label or the id finds
// the model. Filtering on the raw label would match brand words that were
// stripped from the rendered row, surprising the user.
function modelSearchText(
  option: PickerOption<string>,
  providerId: string,
): string {
  return `${stripModelBrandPrefix(option.label, providerId)} ${option.value}`;
}

/**
 * A keyboard-navigable row in the model list. Each entry maps 1:1 to a rendered,
 * highlightable row and drives arrow movement, Enter handling, and the active
 * descendant id — so the fragile hand-computed index math lives in one tested
 * place. The desktop "More models" submenu is intentionally excluded (it stays
 * pointer/native-focus driven); during an active search its filtered options are
 * flattened inline instead, keeping every match reachable from the keyboard.
 */
export type ModelNavRow =
  | { kind: "model"; option: PickerOption<string> }
  | { kind: "more-toggle" };

export function buildModelNavRows({
  modelOptions,
  moreModelOptions,
  isCompactViewport,
  isSearching,
  showMoreModels,
}: {
  modelOptions: readonly PickerOption<string>[];
  moreModelOptions: readonly PickerOption<string>[];
  isCompactViewport: boolean;
  isSearching: boolean;
  showMoreModels: boolean;
}): ModelNavRow[] {
  const rows: ModelNavRow[] = modelOptions.map(
    (option): ModelNavRow => ({ kind: "model", option }),
  );
  if (moreModelOptions.length === 0) return rows;

  // While searching, flatten every match into one list so results otherwise
  // hidden behind the compact toggle or the desktop submenu stay reachable.
  if (isSearching) {
    for (const option of moreModelOptions) rows.push({ kind: "model", option });
    return rows;
  }

  // Compact (not searching): a toggle expands the extra models inline.
  if (isCompactViewport) {
    rows.push({ kind: "more-toggle" });
    if (showMoreModels) {
      for (const option of moreModelOptions) {
        rows.push({ kind: "model", option });
      }
    }
  }

  // Desktop (not searching): the extra models live in the hover submenu, which
  // is rendered separately and left out of keyboard nav.
  return rows;
}

interface ModelReasoningPickerProps {
  // Provider state
  providerOptions: readonly PickerOption<string>[];
  selectedProviderId: string;
  /** Omit to render the provider as locked (tabs hidden, can't preview). */
  onSelectedProviderChange?: (value: string) => void;
  hasMultipleProviders: boolean;
  // Model state
  modelValue: string;
  modelOptions: readonly PickerOption<string>[];
  /** Models rendered behind a collapsed "More models" row. */
  moreModelOptions?: readonly PickerOption<string>[];
  modelIsLoading?: boolean;
  modelLoadFailed?: boolean;
  modelLoadError?: SystemExecutionOptionsModelLoadError | null;
  onModelChange: (value: string) => void;
  /**
   * Optional case-normaliser for raw model names returned by a previewed
   * provider. The picker itself drops the brand prefix at render — callers
   * only need to pass this when the preview API returns un-cased ids.
   */
  formatModelLabel?: (displayName: string) => string;
  // Reasoning state — supported efforts are per-model, so callers derive
  // these options from the SELECTED model and reconcile the level on model
  // change via `reconcileReasoningLevel` in @bb/domain.
  reasoningValue: ReasoningLevel;
  reasoningOptions: readonly PickerOption<ReasoningLevel>[];
  onReasoningChange: (value: ReasoningLevel) => void;
  // Fast mode / service tier
  fastModeEnabled: boolean;
  onFastModeChange: (enabled: boolean) => void;
  showFastModeToggle: boolean;
  serviceTierSupportByProvider?: Record<string, boolean>;
  className?: string;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render with the popover open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the popover blocks page interaction. Defaults to true. */
  modal?: boolean;
  /**
   * Render the trigger as a non-interactive, dimmed label showing the same
   * model/reasoning summary — the popover never opens. Used by read-only
   * surfaces (e.g. the side chat) so they render the identical control as their
   * interactive counterpart, just disabled.
   */
  disabled?: boolean;
  footerAction?: ModelReasoningPickerFooterAction;
}

export interface ModelReasoningPickerFooterAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  iconName?: IconName;
}

export function ModelReasoningPicker({
  providerOptions,
  selectedProviderId,
  onSelectedProviderChange,
  hasMultipleProviders,
  modelValue,
  modelOptions,
  moreModelOptions = [],
  modelIsLoading = false,
  modelLoadFailed = false,
  modelLoadError,
  onModelChange,
  formatModelLabel,
  reasoningValue,
  reasoningOptions,
  onReasoningChange,
  fastModeEnabled,
  onFastModeChange,
  showFastModeToggle,
  serviceTierSupportByProvider,
  className,
  muted,
  defaultOpen = false,
  modal = true,
  disabled,
  footerAction,
}: ModelReasoningPickerProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const [open, setOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  // Unique per picker instance so the active-descendant ids never collide when
  // more than one ModelReasoningPicker is mounted on the page.
  const navId = useId();
  const listboxId = `${navId}-listbox`;
  const optionDomId = (index: number) => `${navId}-opt-${index}`;

  // While the popover is open, the user can browse other providers without
  // committing. `previewProviderId` tracks which provider tab is active;
  // null means "showing the committed provider".
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null,
  );
  // "More models" expansion is per-open: it resets when the popover closes.
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [moreModelsOpen, setMoreModelsOpen] = useState(false);

  const activeProviderId = previewProviderId ?? selectedProviderId;

  const selectedProvider = providerOptions.find(
    (p) => p.value === selectedProviderId,
  );
  const ProviderIcon = selectedProvider?.icon;
  const selectedModelOption = modelOptions.find((m) => m.value === modelValue);
  const selectedModelLabel = selectedModelOption?.label ?? modelValue;
  const hasSelectedModel = selectedModelLabel.trim().length > 0;
  const selectedProviderLabel = selectedProvider?.label ?? selectedProviderId;
  const selectedModelLoadErrorMatches =
    modelLoadError?.providerId === selectedProviderId;
  const selectedModelLoadFailed =
    modelLoadFailed || selectedModelLoadErrorMatches;
  const canSwitchProviders =
    hasMultipleProviders &&
    onSelectedProviderChange !== undefined &&
    providerOptions.length > 1;
  const hasAlternateSelectionPath =
    modelOptions.length > 0 ||
    (selectedModelLoadErrorMatches && canSwitchProviders);
  const selectedModelLoadErrorText =
    selectedModelLoadErrorMatches && modelLoadError
      ? formatModelLoadErrorText({
          error: modelLoadError,
          providerLabel: selectedProviderLabel,
        })
      : "Could not load models.";
  // Strip the brand prefix at render — the trigger always shows the committed
  // provider, so we use `selectedProviderId` (not `activeProviderId`, which
  // can be a preview).
  const triggerModelLabel = modelIsLoading
    ? "Loading models..."
    : hasSelectedModel
      ? stripModelBrandPrefix(selectedModelLabel, selectedProviderId)
      : selectedModelLoadFailed
        ? hasAlternateSelectionPath
          ? "Select model"
          : FAILED_TO_LOAD_MODELS_LABEL
        : modelOptions.length === 0
          ? canSwitchProviders
            ? "Select model"
            : "No models available"
          : "Select model";
  const triggerModelValueIsDestructive =
    triggerModelLabel === FAILED_TO_LOAD_MODELS_LABEL;
  const { base: triggerModelBase, tag: triggerModelTag } =
    splitModelLabelTag(triggerModelLabel);

  const selectedReasoningOption = reasoningOptions.find(
    (r) => r.value === reasoningValue,
  );
  const triggerReasoningLabel = hasSelectedModel
    ? (selectedReasoningOption?.label ?? null)
    : null;

  // Preview other providers without committing. Shares its cache key with the
  // committed `useSystemExecutionOptions` call in the caller's hook so
  // committing is a cache hit, not a refetch.
  const isPreviewing =
    previewProviderId !== null && previewProviderId !== selectedProviderId;
  const previewQuery = useSystemExecutionOptions({
    enabled: isPreviewing,
    providerId: isPreviewing ? previewProviderId : undefined,
  });

  const previewModelOptions = useMemo((): readonly PickerOption<string>[] => {
    if (!isPreviewing) return modelOptions;
    const models = previewQuery.data?.models;
    if (!models || models.length === 0) return [];
    return models.map((model) => ({
      value: model.model,
      label: formatModelLabel
        ? formatModelLabel(model.displayName || model.model)
        : model.displayName || model.model,
    }));
  }, [isPreviewing, modelOptions, previewQuery.data?.models, formatModelLabel]);
  const previewMoreModelOptions =
    useMemo((): readonly PickerOption<string>[] => {
      if (!isPreviewing) return moreModelOptions;
      const models = previewQuery.data?.selectedOnlyModels;
      if (!models || models.length === 0) return [];
      return models.map((model) => ({
        value: model.model,
        label: formatModelLabel
          ? formatModelLabel(model.displayName || model.model)
          : model.displayName || model.model,
      }));
    }, [
      isPreviewing,
      moreModelOptions,
      previewQuery.data?.selectedOnlyModels,
      formatModelLabel,
    ]);
  // While previewing, the reasoning levels belong to the previewed provider's
  // default model (each provider exposes its own set), so the section reflects
  // the tab on screen rather than the committed model.
  const previewDefaultModel = useMemo(() => {
    if (!isPreviewing) return undefined;
    const models = previewQuery.data?.models;
    if (!models || models.length === 0) return undefined;
    return models.find((model) => model.isDefault) ?? models[0];
  }, [isPreviewing, previewQuery.data?.models]);
  const previewReasoningOptions =
    useMemo((): readonly PickerOption<ReasoningLevel>[] => {
      if (!previewDefaultModel) return [];
      const seen = new Set<ReasoningLevel>();
      const options: PickerOption<ReasoningLevel>[] = [];
      for (const effort of previewDefaultModel.supportedReasoningEfforts) {
        if (seen.has(effort.reasoningEffort)) continue;
        seen.add(effort.reasoningEffort);
        options.push({
          value: effort.reasoningEffort,
          label: REASONING_LABELS[effort.reasoningEffort],
        });
      }
      return options;
    }, [previewDefaultModel]);
  const activeReasoningOptions = isPreviewing
    ? previewReasoningOptions
    : reasoningOptions;
  const activeModelLoadError = isPreviewing
    ? (previewQuery.data?.modelLoadError ?? null)
    : (modelLoadError ?? null);
  const activeModelIsLoading = isPreviewing
    ? previewQuery.isLoading
    : modelIsLoading;
  const activeProvider = providerOptions.find(
    (p) => p.value === activeProviderId,
  );
  const activeProviderLabel = activeProvider?.label ?? activeProviderId;
  const activeModelLoadErrorMatches =
    activeModelLoadError?.providerId === activeProviderId;
  const activeModelLoadErrorMessage =
    activeModelLoadErrorMatches && activeModelLoadError
      ? formatModelLoadErrorText({
          error: activeModelLoadError,
          providerLabel: activeProviderLabel,
        })
      : null;
  const activeModelLoadFailed = isPreviewing
    ? previewQuery.isError || activeModelLoadErrorMatches
    : modelLoadFailed || activeModelLoadErrorMatches;
  const activeModelFailureMessage =
    activeModelLoadErrorMessage ?? "Could not load models.";
  const activeModelOptions = previewModelOptions;
  const activeMoreModelOptions = previewMoreModelOptions;
  const hasActiveModelOptions = activeModelOptions.length > 0;
  const activeModelErrorIsProviderSpecific =
    activeModelLoadErrorMatches && activeModelLoadError !== null;
  const isShowingModelError =
    !activeModelIsLoading && !hasActiveModelOptions && activeModelLoadFailed;
  const showProviderTabs =
    hasMultipleProviders &&
    onSelectedProviderChange !== undefined &&
    providerOptions.length > 1 &&
    (!isShowingModelError || activeModelErrorIsProviderSpecific);

  // Filtered model lists (client-side fuzzy search scoped to the active
  // provider). Matching uses the rendered (brand-stripped) label plus the model
  // id so search reflects what the user sees.
  const filteredModelOptions = useMemo(() => {
    return fuzzyFilter(activeModelOptions, normalizedQuery, (option) =>
      modelSearchText(option, activeProviderId),
    );
  }, [activeModelOptions, normalizedQuery, activeProviderId]);

  const filteredMoreModelOptions = useMemo(() => {
    return fuzzyFilter(activeMoreModelOptions, normalizedQuery, (option) =>
      modelSearchText(option, activeProviderId),
    );
  }, [activeMoreModelOptions, normalizedQuery, activeProviderId]);

  // The single navigable-row model that drives arrow keys, Enter, active
  // highlighting, and active-descendant ids.
  const navRows = useMemo(
    () =>
      buildModelNavRows({
        modelOptions: filteredModelOptions,
        moreModelOptions: filteredMoreModelOptions,
        isCompactViewport,
        isSearching,
        showMoreModels,
      }),
    [
      filteredModelOptions,
      filteredMoreModelOptions,
      isCompactViewport,
      isSearching,
      showMoreModels,
    ],
  );

  // The active index clamped to the rows currently on screen. When the list
  // shrinks (e.g. the query narrows it) a now-out-of-range index simply reads as
  // "nothing highlighted" until the user arrows again — no reactive clamping
  // effect required, and it can never point past the end.
  const highlightedIndex =
    activeIndex >= 0 && activeIndex < navRows.length ? activeIndex : -1;

  // When previewing a different provider, resolve fast-mode toggle from that
  // provider's capabilities instead of the committed provider's.
  const effectiveShowFastModeToggle =
    hasActiveModelOptions &&
    (serviceTierSupportByProvider
      ? (serviceTierSupportByProvider[activeProviderId] ?? false)
      : showFastModeToggle);
  const showSelectedFastMode =
    hasSelectedModel && fastModeEnabled && modelOptions.length > 0;
  const showReasoningSection =
    !isShowingModelError &&
    activeReasoningOptions.length > 0 &&
    (isPreviewing
      ? hasActiveModelOptions && !activeModelIsLoading
      : hasSelectedModel && !modelIsLoading && !selectedModelLoadFailed);

  // Reset the per-open browse state (previewed tab + "More models" expansion).
  // This runs when the popover content UNMOUNTS — i.e. after the close
  // animation finishes — not synchronously on close. Resetting on close would
  // snap the visible tab back to the committed provider mid-animation; deferring
  // it to unmount keeps the closing dropdown showing whatever was on screen.
  const resetBrowseState = useCallback(() => {
    setPreviewProviderId(null);
    setShowMoreModels(false);
    setMoreModelsOpen(false);
    setSearchQuery("");
    setActiveIndex(-1);
  }, []);

  const openSub = useCallback(() => {
    setMoreModelsOpen(true);
  }, []);

  const handleModelSelect = useCallback(
    (model: string) => {
      // Commit the previewed provider if it differs from the current one.
      // Preview is only reachable when the picker is unlocked, so onChange
      // is guaranteed to be set when isPreviewing is true.
      if (isPreviewing) {
        onSelectedProviderChange?.(previewProviderId!);
      }
      onModelChange(model);
      setMoreModelsOpen(false);
      setOpen(false);
      setPreviewProviderId(null);
    },
    [isPreviewing, onModelChange, onSelectedProviderChange, previewProviderId],
  );

  const handleReasoningSelect = useCallback(
    (level: ReasoningLevel) => {
      // While previewing, the listed levels are the previewed provider's, so
      // picking one commits that provider's default model at the chosen level —
      // symmetric with picking one of its models.
      if (isPreviewing && previewDefaultModel) {
        onSelectedProviderChange?.(previewProviderId!);
        onModelChange(previewDefaultModel.model);
      }
      onReasoningChange(level);
      // Match the standalone Reasoning OptionPicker's behaviour: picking a
      // value commits and closes.
      setOpen(false);
      setPreviewProviderId(null);
      setMoreModelsOpen(false);
    },
    [
      isPreviewing,
      previewDefaultModel,
      previewProviderId,
      onModelChange,
      onReasoningChange,
      onSelectedProviderChange,
    ],
  );

  const handleFooterActionClick = useCallback(() => {
    if (!footerAction || footerAction.disabled) {
      return;
    }
    footerAction.onClick();
    setOpen(false);
    setPreviewProviderId(null);
    setMoreModelsOpen(false);
  }, [footerAction]);

  // Typing resets the highlight to "none" so a narrowing query never leaves a
  // stale row selected; the user arrows into the fresh results.
  const handleQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    setActiveIndex(-1);
  }, []);

  // Keyboard navigation inside the model list while the search input has focus.
  // All movement/selection is driven by `navRows`, so the index math has a
  // single source of truth shared with rendering. Arrow updates clamp any stale
  // index (a list that shrank out from under the highlight) back into range.
  const handleSearchKeyDown = useCallback<
    KeyboardEventHandler<HTMLInputElement>
  >(
    (event) => {
      const total = navRows.length;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (total === 0) return;
        setActiveIndex((current) => {
          const from = current >= total ? -1 : current;
          return from >= total - 1 ? 0 : from + 1;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (total === 0) return;
        setActiveIndex((current) => {
          const from = current >= total ? -1 : current;
          return from <= 0 ? total - 1 : from - 1;
        });
        return;
      }

      if (event.key === "Enter") {
        if (highlightedIndex < 0) return;
        const row = navRows[highlightedIndex];
        if (!row) return;
        event.preventDefault();
        if (row.kind === "model") {
          handleModelSelect(row.option.value);
        } else {
          setShowMoreModels((current) => !current);
        }
      }
    },
    [navRows, highlightedIndex, handleModelSelect],
  );

  // Scroll the active item into view.
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = document.getElementById(`${navId}-opt-${highlightedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, navId]);

  // Auto-focus the search input on open (desktop only).
  useEffect(() => {
    if (!open || isCompactViewport || isPointerCoarse) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, isCompactViewport, isPointerCoarse]);

  const TriggerIcon = hasSelectedModel ? ProviderIcon : undefined;
  const triggerTitleModelLabel = modelIsLoading
    ? "Loading models..."
    : selectedModelLoadFailed
      ? selectedModelLoadErrorText
      : triggerModelLabel;
  const triggerTitle = [
    `${selectedProviderLabel}: ${triggerTitleModelLabel}`,
    triggerReasoningLabel ? ` · ${triggerReasoningLabel} reasoning` : "",
    showSelectedFastMode ? " (Fast mode)" : "",
  ].join("");

  // The trigger renders identically whether interactive or disabled — the only
  // difference is the `disabled` button state and a dropped chevron — so the
  // disabled read-only surface (e.g. the side chat) shows the same model label
  // in the same position as its editable counterpart.
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label="Provider, model and reasoning"
      disabled={disabled}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        muted && OPTION_MUTED_CLASS_NAME,
        disabled && "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME} title={triggerTitle}>
        {showSelectedFastMode ? (
          <Icon
            name="Zap"
            className="size-3.5 shrink-0 fill-current text-subtle-foreground"
          />
        ) : TriggerIcon ? (
          <TriggerIcon className="size-3.5 shrink-0" />
        ) : null}
        <span
          className={cn(
            "min-w-0 truncate",
            modelIsLoading && "animate-shine whitespace-nowrap",
            triggerModelValueIsDestructive && "text-destructive-text",
          )}
        >
          {triggerModelBase}
        </span>
        {triggerModelTag ? (
          <span className="shrink-0 text-subtle-foreground">
            {triggerModelTag}
          </span>
        ) : null}
        {triggerReasoningLabel ? (
          <span
            className="shrink-0 text-subtle-foreground"
            data-promptbox-hide-compact=""
          >
            {triggerReasoningLabel}
          </span>
        ) : null}
      </span>
      {disabled ? null : (
        <Icon
          name="ChevronDown"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
    </Button>
  );

  if (disabled) {
    return trigger;
  }

  const showSearchInput =
    hasActiveModelOptions &&
    !activeModelIsLoading &&
    !isShowingModelError &&
    activeModelOptions.length + activeMoreModelOptions.length >
      MODEL_SEARCH_MIN_OPTIONS;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        mobileTitle="Model"
        className="flex w-52 flex-col p-0 max-md:w-full max-md:max-w-none"
      >
        <ResetBrowseStateOnUnmount onReset={resetBrowseState} />
        {/* Provider icon tabs */}
        {showProviderTabs ? (
          <div
            className={cn(
              "flex items-center gap-0.5 border-b border-border px-2.5 pt-1",
              isCompactViewport
                ? "sticky top-0 z-10 bg-background"
                : "bg-surface-recessed",
            )}
          >
            {providerOptions.map((provider) => {
              const TabIcon = provider.icon;
              const isActive = provider.value === activeProviderId;
              return (
                <button
                  key={provider.value}
                  type="button"
                  title={provider.label}
                  onClick={() => {
                    if (provider.value !== activeProviderId) {
                      setPreviewProviderId(
                        provider.value === selectedProviderId
                          ? null
                          : provider.value,
                      );
                      // The new tab lists a different provider's models, so drop
                      // the query and highlight from the previous tab. (Committing
                      // a provider closes the popover, where resetBrowseState
                      // clears these anyway.)
                      setSearchQuery("");
                      setActiveIndex(-1);
                    }
                  }}
                  className={cn(
                    "flex items-center justify-center border-b-2 focus-visible:outline-none",
                    LIST_HOVER_TRANSITION,
                    COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS,
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TabIcon ? (
                    <TabIcon className={COARSE_POINTER_ICON_SIZE_CLASS} />
                  ) : (
                    <span
                      className={cn(
                        "font-medium",
                        COARSE_POINTER_TEXT_SM_CLASS,
                      )}
                    >
                      {provider.label.charAt(0)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        {showSearchInput ? (
          <ModelSearchInput
            inputRef={searchInputRef}
            query={searchQuery}
            onQueryChange={handleQueryChange}
            onKeyDown={handleSearchKeyDown}
            listboxId={listboxId}
            activeOptionId={
              highlightedIndex >= 0 ? optionDomId(highlightedIndex) : undefined
            }
          />
        ) : null}

        <MenuHoverProvider>
          {/* Model list — keyed by the active provider so each provider mounts a
            fresh subtree. Rows are keyed by model id, but reusing one subtree
            across provider switches was observed to leave the previous
            provider's rows on screen; remounting per provider guarantees the
            list always matches the active tab. */}
          <div
            key={activeProviderId || "no-provider"}
            role={showSearchInput ? "listbox" : undefined}
            id={showSearchInput ? listboxId : undefined}
            aria-label={showSearchInput ? "Models" : undefined}
            className={cn(
              "overflow-y-auto px-1 pb-1 pt-0",
              !isCompactViewport &&
                "max-h-[min(250px,var(--radix-popover-content-available-height,250px)-80px)]",
            )}
          >
            {isShowingModelError ? null : (
              <MenuSectionLabel>Model</MenuSectionLabel>
            )}
            {activeModelIsLoading ? (
              <div
                className={cn(
                  "px-2 text-xs text-muted-foreground",
                  isCompactViewport ? "py-2" : "py-[0.3125rem]",
                )}
              >
                Loading models…
              </div>
            ) : hasActiveModelOptions ? (
              <>
                {navRows.map((row, index) => {
                  const active = highlightedIndex === index;
                  const domId = optionDomId(index);
                  if (row.kind === "more-toggle") {
                    return (
                      <MoreModelsToggleRow
                        key="more-toggle"
                        id={domId}
                        isActive={active}
                        expanded={showMoreModels}
                        onToggle={() =>
                          setShowMoreModels((current) => !current)
                        }
                      />
                    );
                  }
                  const option = row.option;
                  return (
                    <MenuRowButton
                      key={option.value}
                      id={domId}
                      role={showSearchInput ? "option" : undefined}
                      isActive={active}
                      // The menu always reflects the provider whose models it
                      // lists (committed or previewed) — strip with
                      // `activeProviderId`.
                      label={stripModelBrandPrefix(
                        option.label,
                        activeProviderId,
                      )}
                      selected={!isPreviewing && option.value === modelValue}
                      onClick={() => handleModelSelect(option.value)}
                    />
                  );
                })}
                {/* Desktop, not searching: the selected-only models live in a
                    hover submenu that is excluded from keyboard nav. During a
                    search they are flattened into `navRows` above so every match
                    stays reachable from the keyboard. */}
                {!isCompactViewport &&
                !isSearching &&
                filteredMoreModelOptions.length > 0 ? (
                  <MoreModelsSubmenu
                    open={moreModelsOpen}
                    onOpenChange={setMoreModelsOpen}
                    openSub={openSub}
                    activeProviderId={activeProviderId}
                    isPreviewing={isPreviewing}
                    modelValue={modelValue}
                    options={filteredMoreModelOptions}
                    onSelect={handleModelSelect}
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
                title={activeModelLoadErrorMessage ?? undefined}
              >
                {activeModelLoadErrorMatches && activeModelLoadError ? (
                  <ModelLoadErrorMessage
                    error={activeModelLoadError}
                    providerLabel={activeProviderLabel}
                  />
                ) : activeModelLoadFailed ? (
                  activeModelFailureMessage
                ) : (
                  "No models available"
                )}
              </div>
            )}
          </div>

          {/* Reasoning section — the committed model's levels, or (while
            previewing) the previewed provider's default-model levels. Like the
            model list, nothing is checked during preview until committed. */}
          {showReasoningSection ? (
            <>
              <div className="border-t border-border" />
              <div className="px-1 pb-1 pt-0">
                <MenuSectionLabel>Reasoning</MenuSectionLabel>
                {activeReasoningOptions.map((option) => (
                  <MenuRowButton
                    key={option.value}
                    label={option.label}
                    selected={!isPreviewing && option.value === reasoningValue}
                    onClick={() => handleReasoningSelect(option.value)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* Fast mode toggle */}
          {effectiveShowFastModeToggle ? (
            <>
              <div className="border-t border-border" />
              <div className="p-1">
                <div className="flex items-center justify-between gap-3 rounded-sm px-2 py-[0.3125rem] text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      name="Zap"
                      className="size-4 fill-current text-muted-foreground"
                    />
                    <span>Fast mode</span>
                  </span>
                  <Switch
                    checked={fastModeEnabled}
                    onCheckedChange={onFastModeChange}
                    aria-label="Fast mode"
                    className={LIST_HOVER_TRANSITION}
                  />
                </div>
              </div>
            </>
          ) : null}

          {footerAction ? (
            <>
              <div className="border-t border-border" />
              <div className="p-1">
                <MenuActionButton
                  label={footerAction.label}
                  iconName={footerAction.iconName ?? "MessageSquarePlus"}
                  disabled={footerAction.disabled}
                  title={footerAction.title}
                  onClick={handleFooterActionClick}
                />
              </div>
            </>
          ) : null}
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}

// Mirrors DropdownMenuLabel spacing/typography while staying sticky in the
// scrollable model list.
function MenuSectionLabel({ children }: { children: ReactNode }) {
  const isCompactViewport = useIsCompactViewport();

  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-background px-2 text-xs font-medium text-muted-foreground",
        isCompactViewport ? "pb-1.5 pt-2" : "pb-[0.3125rem] pt-2",
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
  onPointerEnter: callerPointerEnter,
  onKeyDown: callerKeyDown,
}: {
  expanded: boolean;
  onToggle: () => void;
  isActive?: boolean;
  id?: string;
  onPointerEnter?: PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}) {
  const { hoverProps } = useMenuItemHover({
    onPointerEnter: callerPointerEnter,
    onKeyDown: callerKeyDown,
  });
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
  activeProviderId,
  isPreviewing,
  modelValue,
  options,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openSub: () => void;
  activeProviderId: string;
  isPreviewing: boolean;
  modelValue: string;
  options: readonly PickerOption<string>[];
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

  // Close the moment the pointer moves to a sibling row — i.e. this trigger is
  // no longer the menu's last-hovered item. No close-delay, so the trigger tile
  // and the submenu clear at 0ms. While the pointer is inside the submenu the
  // trigger stays the MAIN menu's last-hovered item (the submenu items have
  // their own hover scope), so this does not fire and the submenu stays open.
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
        className="flex w-52 flex-col p-1 data-[state=closed]:animate-none"
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
              label={stripModelBrandPrefix(option.label, activeProviderId)}
              selected={!isPreviewing && option.value === modelValue}
              onClick={() => onSelect(option.value)}
            />
          ))}
        </MenuHoverProvider>
      </PopoverContent>
    </Popover>
  );
}

// Renders nothing; exists only to fire `onReset` when it unmounts. Mounted
// inside PopoverContent, so its unmount coincides with the popover fully
// closing (after the exit animation), which is when the browse state should
// reset — not during the visible close. Kept stable via a ref so a re-render
// never triggers a spurious reset.
function ResetBrowseStateOnUnmount({ onReset }: { onReset: () => void }) {
  useEffect(() => onReset, [onReset]);
  return null;
}

function MenuRowButton({
  label,
  selected,
  onClick,
  isActive,
  id,
  role,
  onPointerEnter: callerPointerEnter,
  onKeyDown: callerKeyDown,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  isActive?: boolean;
  id?: string;
  role?: React.AriaRole;
  onPointerEnter?: PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}) {
  const { hoverProps } = useMenuItemHover({
    onPointerEnter: callerPointerEnter,
    onKeyDown: callerKeyDown,
  });
  const isCompactViewport = useIsCompactViewport();
  const { base, tag } = splitModelLabelTag(label);
  return (
    <button
      type="button"
      id={id}
      role={role}
      // In the searchable listbox the active row is the combobox's
      // aria-activedescendant, so it carries aria-selected; reasoning/submenu
      // rows keep default button semantics.
      aria-selected={role === "option" ? Boolean(isActive) : undefined}
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 text-xs outline-none hover:bg-state-hover hover:text-foreground",
        LIST_HOVER_TRANSITION,
        MENU_ITEM_LAST_HOVERED_CLASS,
        isActive && "bg-state-active",
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
      {...hoverProps}
    >
      <span className="truncate" title={label}>
        {base}
        {tag ? (
          <span className="ml-1.5 text-subtle-foreground">{tag}</span>
        ) : null}
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

function MenuActionButton({
  label,
  iconName,
  disabled,
  title,
  onClick,
}: {
  label: string;
  iconName: IconName;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  const { hoverProps } = useMenuItemHover();
  const isCompactViewport = useIsCompactViewport();
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 text-xs outline-none hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
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
interface ModelSearchInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  /** Id of the listbox this combobox controls (for `aria-controls`). */
  listboxId: string;
  /** Id of the virtually-focused option, or undefined when none is active. */
  activeOptionId: string | undefined;
}

function ModelSearchInput({
  inputRef,
  query,
  onQueryChange,
  onKeyDown,
  listboxId,
  activeOptionId,
}: ModelSearchInputProps) {
  return (
    <div className="shrink-0 border-b border-border px-1.5 py-1">
      <div className="relative">
        <Icon
          name="Search"
          // size-4 + left-1.5 puts this icon at the same x (12px from the
          // popover edge, center 20px) as the Fast mode "Zap" icon below, so the
          // two leading icons line up vertically.
          className="pointer-events-none absolute left-1.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search models"
          aria-label="Search models"
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          className="h-7 border-0 bg-transparent pl-8 pr-2 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}
