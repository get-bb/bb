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
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@bb/server-contract";
import type { ReasoningLevel } from "@bb/domain";
import {
  stripModelBrandPrefix,
  type ProviderPickerOption,
} from "./model-brand-prefix";
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
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  MENU_ITEM_LAST_HOVERED_CLASS,
  MenuHoverProvider,
  useMenuItemHover,
} from "@bb/shared-ui/menu-item-hover";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { resolveModelCatalogSelection } from "@/hooks/thread-creation-options/model-catalog-selection";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { type PickerOption } from "./OptionPicker";
import type { ModelPickerOption } from "./model-picker-option";
import {
  formatModelLoadErrorText,
  ModelLoadErrorMessage,
} from "./model-load-error-message";
import {
  useAppCommandContext,
  useAppCommandHandler,
  useAppCommandShortcut,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  ownsModelPickerCycleChord,
  resolveModelPickerToggle,
  type ModelPickerScope,
} from "./modelPickerToggle";
import {
  cycleReasoningValue,
  nextCycleValue,
  previousCycleValue,
} from "./modelPickerCycle";

interface ModelLabelParts {
  base: string;
  tag: string | null;
}

interface ResolvedProviderPreview {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  supportsServiceTier: boolean;
}

const FAILED_TO_LOAD_MODELS_LABEL = "Failed to load models";
const EMPTY_MODEL_OPTIONS: readonly ModelPickerOption[] = [];
const preserveModelLabel = (displayName: string): string => displayName;
const MODEL_CYCLE_COMMANDS = [
  "modelPicker.cycleModel",
  "modelPicker.cycleModelBackward",
] as const;
const PROVIDER_CYCLE_COMMANDS = [
  "modelPicker.cycleProvider",
  "modelPicker.cycleProviderBackward",
] as const;
const REASONING_CYCLE_COMMANDS = [
  "modelPicker.cycleReasoning",
  "modelPicker.cycleReasoningBackward",
] as const;

// Below this many models (primary + selected-only) the list is short enough to
// scan by eye, so the search box is more clutter than help.
const MODEL_SEARCH_MIN_OPTIONS = 5;
const MODEL_PICKER_MENU_WIDTH_CLASS_NAME = "w-max min-w-52 max-w-80";

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
  option: ModelPickerOption,
  brandPrefix: string | undefined,
): string {
  return `${stripModelBrandPrefix(option.label, brandPrefix)} ${option.routeProviderId ?? ""} ${option.value}`;
}

/**
 * A keyboard-navigable row in the model list. Each entry maps 1:1 to a rendered,
 * highlightable row and drives arrow movement, Enter handling, and the active
 * descendant id — so the fragile hand-computed index math lives in one tested
 * place. The desktop "More models" submenu is intentionally excluded (it stays
 * pointer/native-focus driven); during an active search its filtered options are
 * flattened inline instead, keeping every match reachable from the keyboard.
 */
type ModelNavRow =
  | { kind: "model"; option: ModelPickerOption }
  | { kind: "more-toggle" };

export function buildModelNavRows({
  modelOptions,
  moreModelOptions,
  isCompactViewport,
  isSearching,
  showMoreModels,
}: {
  modelOptions: readonly ModelPickerOption[];
  moreModelOptions: readonly ModelPickerOption[];
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
  providerRouting?: SystemProvidersQuery;
  providerOptions: readonly ProviderPickerOption[];
  selectedProviderId: string;
  /** Omit to render the provider as locked (tabs hidden, can't switch). */
  onSelectedProviderChange?: (value: string) => void;
  /** Reports a provider only after its live catalog resolves a coherent default. */
  onProviderPreviewResolved?: (value: ResolvedProviderPreview) => void;
  /** Prevent preview selection until the provider catalog is authoritative. */
  requireVerifiedProviderPreview?: boolean;
  hasMultipleProviders: boolean;
  // Model state
  modelValue: string;
  modelOptions: readonly ModelPickerOption[];
  /** Models rendered behind a collapsed "More models" row. */
  moreModelOptions?: readonly ModelPickerOption[];
  modelIsLoading?: boolean;
  modelLoadFailed?: boolean;
  modelLoadError?: SystemExecutionOptionsModelLoadError | null;
  onModelChange: (value: string) => void;
  /**
   * Optional case-normaliser for raw model names returned during a provider
   * handoff. The picker itself drops the brand prefix at render — callers only
   * need to pass this when the provider API returns un-cased ids.
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
  /** Whether composer model-picker commands and hints apply. Defaults to true. */
  commandShortcutsEnabled?: boolean;
  serviceTierSupportByProvider?: Record<string, boolean>;
  className?: string;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render with the popover open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the popover blocks page interaction. Defaults to true. */
  modal?: boolean;
  /** Horizontal popover alignment. Defaults to "start". */
  align?: "start" | "center" | "end";
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
  providerRouting,
  selectedProviderId,
  onSelectedProviderChange,
  onProviderPreviewResolved,
  requireVerifiedProviderPreview = false,
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
  commandShortcutsEnabled = true,
  serviceTierSupportByProvider,
  className,
  muted,
  defaultOpen = false,
  modal = true,
  align = "start",
  disabled,
  footerAction,
}: ModelReasoningPickerProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const [open, setOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const registeredToggleShortcut = useAppCommandShortcut("modelPicker.toggle");
  const toggleShortcut = commandShortcutsEnabled
    ? registeredToggleShortcut
    : null;
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

  // A controlled parent may need one render to apply a provider-tab change.
  // Keep showing the clicked provider's cached/querying catalog during that
  // handoff so the tab responds immediately without flashing the old models.
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null,
  );
  // "More models" expansion is per-open: it resets when the popover closes.
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [moreModelsOpen, setMoreModelsOpen] = useState(false);
  const [trackedSelectedProviderId, setTrackedSelectedProviderId] =
    useState(selectedProviderId);

  // A controlled provider change commits any pending preview. Reset during
  // render so an external rehydration cannot paint an old provider's browse
  // state for a frame. This deliberately leaves `open` untouched.
  if (trackedSelectedProviderId !== selectedProviderId) {
    setTrackedSelectedProviderId(selectedProviderId);
    setPreviewProviderId(null);
    setShowMoreModels(false);
    setMoreModelsOpen(false);
    setSearchQuery("");
    setActiveIndex(-1);
  }

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
      ? stripModelBrandPrefix(selectedModelLabel, selectedProvider?.brandPrefix)
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

  // Shares its cache key with the committed `useSystemExecutionOptions` call
  // in the caller's hook, so the controlled-provider handoff is a cache hit.
  const isPreviewing =
    previewProviderId !== null && previewProviderId !== selectedProviderId;
  const previewQuery = useSystemExecutionOptions({
    enabled: isPreviewing,
    ...providerRouting,
    providerId: isPreviewing ? previewProviderId : undefined,
  });
  const previewSelectionBlocked =
    requireVerifiedProviderPreview &&
    isPreviewing &&
    (previewQuery.data === undefined ||
      previewQuery.isPlaceholderData ||
      previewQuery.isError ||
      previewQuery.data.modelLoadError !== null);
  const previewCatalogIsVerified =
    isPreviewing &&
    previewQuery.data !== undefined &&
    !previewQuery.isPlaceholderData &&
    !previewQuery.isError &&
    previewQuery.data.modelLoadError === null;

  const previewSelection = useMemo(
    () =>
      isPreviewing
        ? resolveModelCatalogSelection({
            models: previewQuery.data?.models ?? [],
            selectedOnlyModels: previewQuery.data?.selectedOnlyModels ?? [],
            selectedModel: "",
            preferredReasoningLevel: reasoningValue,
            catalogIsVerified: previewCatalogIsVerified,
            formatModelLabel: formatModelLabel ?? preserveModelLabel,
          })
        : null,
    [
      formatModelLabel,
      isPreviewing,
      previewCatalogIsVerified,
      previewQuery.data?.models,
      previewQuery.data?.selectedOnlyModels,
      reasoningValue,
    ],
  );
  const previewModelOptions = previewSelection?.modelOptions ?? modelOptions;
  const previewMoreModelOptions =
    previewSelection?.moreModelOptions ?? moreModelOptions;
  useEffect(() => {
    if (
      !previewCatalogIsVerified ||
      !previewProviderId ||
      !previewSelection?.selectedModel
    ) {
      return;
    }
    const provider = previewQuery.data?.providers.find(
      (candidate) => candidate.id === previewProviderId,
    );
    onProviderPreviewResolved?.({
      providerId: previewProviderId,
      model: previewSelection.selectedModel,
      reasoningLevel: previewSelection.reasoningLevel,
      supportsServiceTier: provider?.capabilities.supportsServiceTier ?? false,
    });
  }, [
    onProviderPreviewResolved,
    previewCatalogIsVerified,
    previewProviderId,
    previewQuery.data?.providers,
    previewSelection,
  ]);
  const activeReasoningOptions = isPreviewing
    ? (previewSelection?.reasoningOptions ?? [])
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
  const activeMoreModelOptions = previewSelectionBlocked
    ? EMPTY_MODEL_OPTIONS
    : previewMoreModelOptions;
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
  const activeBrandPrefix = activeProvider?.brandPrefix;
  const filteredModelOptions = useMemo(() => {
    return fuzzyFilter(activeModelOptions, normalizedQuery, (option) =>
      modelSearchText(option, activeBrandPrefix),
    );
  }, [activeModelOptions, normalizedQuery, activeBrandPrefix]);

  const filteredMoreModelOptions = useMemo(() => {
    return fuzzyFilter(activeMoreModelOptions, normalizedQuery, (option) =>
      modelSearchText(option, activeBrandPrefix),
    );
  }, [activeMoreModelOptions, normalizedQuery, activeBrandPrefix]);

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

  // Reset the per-open browse state after the close animation. Desktop content
  // unmounts at that point. The compact drawer stays mounted, so its settlement
  // callback performs the same reset without changing the visible close frame.
  const resetBrowseState = useCallback(() => {
    setPreviewProviderId(null);
    setShowMoreModels(false);
    setMoreModelsOpen(false);
    setSearchQuery("");
    setActiveIndex(-1);
  }, []);
  const handleMobileContentAnimationEnd = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        resetBrowseState();
      }
    },
    [resetBrowseState],
  );

  const openSub = useCallback(() => {
    setMoreModelsOpen(true);
  }, []);

  const handleModelSelect = useCallback(
    (model: string) => {
      if (previewSelectionBlocked) return;
      onModelChange(model);
      setMoreModelsOpen(false);
      setPreviewProviderId(null);
    },
    [onModelChange, previewSelectionBlocked],
  );

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      onSelectedProviderChange?.(providerId);
      const nextPreviewProviderId =
        open && providerId !== selectedProviderId ? providerId : null;
      setPreviewProviderId(nextPreviewProviderId);
      // Every provider owns a different model list. Never carry a filter or
      // keyboard highlight across that boundary.
      setSearchQuery("");
      setActiveIndex(-1);
    },
    [onSelectedProviderChange, open, selectedProviderId],
  );

  // Scope Cmd+Shift+M and the cycle chords to one composer of the focused pane.
  // Standalone/single-pane surfaces have no pane context and default to
  // focused/non-split.
  const paneContext = useOptionalPaneContext();
  const isFocusedPane = paneContext?.isFocused ?? true;
  const isSplitPane = paneContext?.isSplitPane ?? false;
  const resolveCommandScope = useCallback(
    (target: EventTarget | null): ModelPickerScope => {
      const pickerComposer =
        triggerRef.current?.closest("[data-app-composer]") ?? null;
      const caretComposer =
        target instanceof HTMLElement
          ? target.closest("[data-app-composer]")
          : null;
      // Two composers of the same pane share its `[data-split-pane-id]` wrapper;
      // a lone surface has none, so this stays false there.
      const pickerPane =
        triggerRef.current?.closest("[data-split-pane-id]") ?? null;
      const caretPane = caretComposer?.closest("[data-split-pane-id]") ?? null;
      return {
        disabled: disabled ?? false,
        isFocusedPane,
        isSplitPane,
        // The main/new-thread composer is primary; a side chat marks itself
        // secondary via data-app-composer-role.
        isPrimaryComposer:
          pickerComposer?.getAttribute("data-app-composer-role") !==
          "secondary",
        caretInThisComposer:
          caretComposer !== null && caretComposer === pickerComposer,
        caretInOtherComposerOfPane:
          caretComposer !== null &&
          caretComposer !== pickerComposer &&
          pickerPane !== null &&
          caretPane === pickerPane,
        editableOutsideComposer:
          caretComposer === null && isEditableKeyboardTarget(target),
      };
    },
    [disabled, isFocusedPane, isSplitPane],
  );
  useAppCommandContext(
    "modelPickerOpen",
    commandShortcutsEnabled && open && !disabled,
  );
  const ownsCycleChord = (target: EventTarget | null): boolean =>
    commandShortcutsEnabled &&
    ownsModelPickerCycleChord({ open, ...resolveCommandScope(target) });
  useAppCommandHandler(
    "modelPicker.toggle",
    ({ target }) => {
      if (!commandShortcutsEnabled) return false;
      const action = resolveModelPickerToggle({
        open,
        ...resolveCommandScope(target),
      });
      if (action === "ignore") return false;
      setOpen(action === "open");
      return true;
    },
    50,
    commandShortcutsEnabled,
  );
  // The cycle chords rotate the COMMITTED provider and its lists, never a
  // previewed tab's, so the shortcut means the same thing whether the popover is
  // open or shut. A preview in progress is dropped so the visible tab keeps
  // matching the committed selection.
  //
  // An in-scope chord ALWAYS returns true, even with nowhere to rotate to. A
  // false result makes the command provider bail before `preventDefault()`, and
  // macOS would then insert the composed Option character (Option+M → "µ") into
  // the prompt. Owning the chord and doing nothing is the correct no-op.
  useIndexedAppCommandHandlers(
    MODEL_CYCLE_COMMANDS,
    (index, { target }) => {
      if (!ownsCycleChord(target)) return false;
      const next =
        index === 0
          ? nextCycleValue(modelOptions, modelValue)
          : previousCycleValue(modelOptions, modelValue);
      if (next !== null) {
        onModelChange(next);
        setPreviewProviderId(null);
      }
      return true;
    },
    50,
    commandShortcutsEnabled,
  );
  useIndexedAppCommandHandlers(
    PROVIDER_CYCLE_COMMANDS,
    (index, { target }) => {
      if (!ownsCycleChord(target)) return false;
      if (canSwitchProviders && onSelectedProviderChange !== undefined) {
        const next =
          index === 0
            ? nextCycleValue(providerOptions, selectedProviderId)
            : previousCycleValue(providerOptions, selectedProviderId);
        if (next !== null) {
          handleProviderSelect(next);
        }
      }
      return true;
    },
    50,
    commandShortcutsEnabled,
  );
  useIndexedAppCommandHandlers(
    REASONING_CYCLE_COMMANDS,
    (index, { target }) => {
      if (!ownsCycleChord(target)) return false;
      const next = cycleReasoningValue(
        reasoningOptions,
        reasoningValue,
        index === 0 ? "forward" : "backward",
      );
      if (next !== null) {
        onReasoningChange(next);
        setPreviewProviderId(null);
      }
      return true;
    },
    50,
    commandShortcutsEnabled,
  );
  const handleReasoningSelect = useCallback(
    (level: ReasoningLevel) => {
      if (previewSelectionBlocked) return;
      // A controlled parent that has not rendered the provider change yet
      // still needs a concrete model when the user immediately picks one of
      // the new provider's reasoning levels.
      if (isPreviewing && previewSelection?.selectedModel) {
        onModelChange(previewSelection.selectedModel);
      }
      onReasoningChange(level);
      // Keep the combined picker open so the model and reasoning effort can be
      // changed together without reopening it between selections.
      setPreviewProviderId(null);
      setMoreModelsOpen(false);
    },
    [
      isPreviewing,
      previewSelection,
      onModelChange,
      onReasoningChange,
      previewSelectionBlocked,
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

  const TriggerIcon =
    hasSelectedModel || modelIsLoading ? ProviderIcon : undefined;
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
  // difference is the `disabled` button state and a dropped chevron — so fully
  // read-only surfaces show the same model label in the same position as their
  // editable counterpart.
  const trigger = (
    <Button
      ref={triggerRef}
      type="button"
      variant="ghost"
      size="sm"
      aria-label={
        toggleShortcut
          ? `Provider, model and reasoning (${toggleShortcut.label})`
          : "Provider, model and reasoning"
      }
      aria-keyshortcuts={toggleShortcut?.ariaKeyshortcuts}
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
        {modelIsLoading ? (
          <>
            {TriggerIcon ? (
              <TriggerIcon className="size-3.5 shrink-0" />
            ) : (
              <Icon
                name="Spinner"
                className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
            <span className="sr-only">Loading models</span>
            <Skeleton
              aria-hidden
              data-model-loading-placeholder="trigger-model"
              className="h-3 w-10 shrink-0 rounded-sm"
            />
            <Skeleton
              aria-hidden
              data-model-loading-placeholder="trigger-reasoning"
              className="h-3 w-8 shrink-0 rounded-sm"
            />
          </>
        ) : showSelectedFastMode ? (
          <Icon
            name="Zap"
            className="size-3.5 shrink-0 fill-current text-subtle-foreground"
          />
        ) : TriggerIcon ? (
          <TriggerIcon className="size-3.5 shrink-0" />
        ) : null}
        {modelIsLoading ? null : (
          <>
            <span
              className={cn(
                "min-w-0 truncate",
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
          </>
        )}
      </span>
      {disabled ? null : (
        <Icon
          name="ChevronDown"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      )}
      <AppCommandShortcutHint
        shortcut={disabled ? null : toggleShortcut}
        className="ml-1"
      />
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
        align={align}
        mobileTitle="Model"
        onMobileContentAnimationEnd={handleMobileContentAnimationEnd}
        className={cn(
          "flex flex-col p-0",
          MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
          "max-md:w-full max-md:min-w-0 max-md:max-w-none",
          !isCompactViewport &&
            "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain",
        )}
      >
        <ResetBrowseStateOnContentUnmount onReset={resetBrowseState} />
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
                      handleProviderSelect(provider.value);
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
                // Preserve the model scroller's intended height when the outer
                // menu is capped; otherwise this flex item collapses before the
                // full desktop menu can scroll to the reasoning controls.
                "shrink-0 max-h-[min(250px,var(--radix-popover-content-available-height,250px)-80px)]",
            )}
          >
            {isShowingModelError ? null : (
              <MenuSectionLabel>Model</MenuSectionLabel>
            )}
            {activeModelIsLoading ? (
              <ModelPickerLoadingRows />
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
                      // lists (committed or previewed) — strip with the
                      // active provider's declared prefix.
                      label={stripModelBrandPrefix(
                        option.label,
                        activeBrandPrefix,
                      )}
                      qualifier={option.routeProviderId}
                      selected={!isPreviewing && option.value === modelValue}
                      disabled={previewSelectionBlocked}
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
                    activeBrandPrefix={activeBrandPrefix}
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
                    {...(activeProvider?.installUrl === undefined
                      ? {}
                      : { installUrl: activeProvider.installUrl })}
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
                    disabled={previewSelectionBlocked}
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

const MODEL_LOADING_ROW_WIDTHS = ["w-20", "w-28", "w-24", "w-32"] as const;

function ModelPickerLoadingRows() {
  const isCompactViewport = useIsCompactViewport();

  return (
    <div role="status" aria-label="Loading models" className="pb-1">
      <span className="sr-only">Loading models</span>
      {MODEL_LOADING_ROW_WIDTHS.map((widthClassName) => (
        <div
          key={widthClassName}
          data-model-loading-row=""
          aria-hidden
          className={cn(
            "flex items-center rounded-sm px-2",
            isCompactViewport ? "py-2" : "py-[0.3125rem]",
          )}
        >
          <Skeleton
            className={cn("h-3 max-w-[75%] rounded-sm", widthClassName)}
          />
        </div>
      ))}
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
        className={cn(
          "flex flex-col p-1 data-[state=closed]:animate-none",
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

// Renders nothing; exists only to fire `onReset` when it unmounts. Mounted
// inside PopoverContent, so its unmount coincides with the popover fully
// closing (after the exit animation), which is when the browse state should
// reset — not during the visible close. Kept stable via a ref so a re-render
// never triggers a spurious reset.
function ResetBrowseStateOnContentUnmount({
  onReset,
}: {
  onReset: () => void;
}) {
  useEffect(() => onReset, [onReset]);
  return null;
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
  onPointerEnter: callerPointerEnter,
  onKeyDown: callerKeyDown,
}: {
  label: string;
  qualifier?: string;
  selected: boolean;
  disabled?: boolean;
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
      disabled={disabled}
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
