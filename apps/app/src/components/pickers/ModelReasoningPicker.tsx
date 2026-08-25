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
import { fastServiceTierLabel } from "@/lib/reasoning-labels";
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
import { executionPickerOrderToken } from "./execution-picker-selection";
import type { PluginExecutionPickerEntrySlot } from "@/lib/plugin-slots";
import { isKnownIconName } from "@/lib/provider-icon";
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
const EMPTY_PLUGIN_ENTRIES: readonly PluginExecutionPickerEntrySlot[] = [];
const EMPTY_EXECUTION_ORDER: readonly string[] = [];

/**
 * One tab in the strip above the model list: a real provider, or a plugin's
 * entry. Both carry a `token` so one `providerOrder`-derived rank sorts them
 * together; `kind` is what the click handler branches on.
 */
/**
 * The entry's declared glyph as an icon NAME, not a component.
 *
 * Resolving to a component here would mint one during render, which the React
 * compiler rejects (and which would break memoization for every row). The
 * caller renders `<Icon name={...} />` directly instead. An unknown name
 * resolves to null so the letter fallback renders, matching how a provider's
 * unknown glyph degrades.
 */
function pluginEntryIconName(
  entry: PluginExecutionPickerEntrySlot,
): IconName | null {
  if (entry.iconName === undefined) return null;
  return isKnownIconName(entry.iconName) ? entry.iconName : null;
}

type ExecutionTab =
  | { kind: "provider"; token: string; option: ProviderPickerOption }
  | { kind: "plugin-entry"; token: string; entry: PluginExecutionPickerEntrySlot };

/**
 * Providers and plugin entries in one order.
 *
 * `providerOptions` already arrives server-sorted (the server applies
 * `providerOrder` to the providers it knows about). Plugin entries are
 * app-side registrations the server has never heard of, so this is the only
 * place the two can be interleaved — hence re-applying the same pinned-rank
 * rule here over both, rather than trusting the server order alone.
 */
function buildExecutionTabs(
  providerOptions: readonly ProviderPickerOption[],
  pluginEntries: readonly PluginExecutionPickerEntrySlot[],
  executionOrder: readonly string[],
): ExecutionTab[] {
  const tabs: ExecutionTab[] = [
    ...providerOptions.map<ExecutionTab>((option) => ({
      kind: "provider",
      token: executionPickerOrderToken({
        kind: "provider",
        providerId: option.value,
      }),
      option,
    })),
    ...[...pluginEntries]
      .sort(
        (a, b) =>
          a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
      )
      .map<ExecutionTab>((entry) => ({
        kind: "plugin-entry",
        token: executionPickerOrderToken({
          kind: "plugin-entry",
          pluginId: entry.pluginId,
          entryId: entry.id,
        }),
        entry,
      })),
  ];
  if (executionOrder.length === 0) return tabs;
  const rank = new Map(executionOrder.map((token, index) => [token, index]));
  return tabs.sort(
    (a, b) =>
      (rank.get(a.token) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.token) ?? Number.MAX_SAFE_INTEGER),
  );
}
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

const MODEL_SEARCH_MIN_OPTIONS = 5;
const MODEL_PICKER_MENU_WIDTH_CLASS_NAME = "w-max min-w-52 max-w-80";

function splitModelLabelTag(label: string): ModelLabelParts {
  const match = label.match(/^(.*\S)\s*\(([^()]+)\)$/u);
  if (!match) {
    return { base: label, tag: null };
  }
  return { base: match[1], tag: match[2] };
}

export function buildFuzzyRegex(query: string): RegExp {
  const pattern = query
    .split("")
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(pattern, "i");
}

function fuzzyFilter<T>(
  options: readonly T[],
  normalizedQuery: string,
  getText: (option: T) => string,
): readonly T[] {
  if (!normalizedQuery) return options;
  const regex = buildFuzzyRegex(normalizedQuery);
  return options.filter((option) => regex.test(getText(option)));
}

function modelSearchText(
  option: ModelPickerOption,
  brandPrefix: string | undefined,
): string {
  return `${stripModelBrandPrefix(option.label, brandPrefix)} ${option.routeProviderId ?? ""} ${option.value}`;
}

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
  const rows: ModelNavRow[] = modelOptions.map((option): ModelNavRow => ({
    kind: "model",
    option,
  }));
  if (moreModelOptions.length === 0) return rows;

  if (isSearching) {
    for (const option of moreModelOptions) rows.push({ kind: "model", option });
    return rows;
  }

  if (isCompactViewport) {
    rows.push({ kind: "more-toggle" });
    if (showMoreModels) {
      for (const option of moreModelOptions) {
        rows.push({ kind: "model", option });
      }
    }
  }

  return rows;
}

interface ModelReasoningPickerProps {
  providerRouting?: SystemProvidersQuery;
  providerOptions: readonly ProviderPickerOption[];
  selectedProviderId: string;
  onSelectedProviderChange?: (value: string) => void;
  onProviderPreviewResolved?: (value: ResolvedProviderPreview) => void;
  requireVerifiedProviderPreview?: boolean;
  hasMultipleProviders: boolean;
  modelValue: string;
  modelOptions: readonly ModelPickerOption[];
  moreModelOptions?: readonly ModelPickerOption[];
  modelIsLoading?: boolean;
  modelLoadFailed?: boolean;
  modelLoadError?: SystemExecutionOptionsModelLoadError | null;
  onModelChange: (value: string) => void;
  formatModelLabel?: (displayName: string) => string;
  reasoningValue: ReasoningLevel;
  reasoningOptions: readonly PickerOption<ReasoningLevel>[];
  onReasoningChange: (value: ReasoningLevel) => void;
  fastModeEnabled: boolean;
  onFastModeChange: (enabled: boolean) => void;
  showFastModeToggle: boolean;
  commandShortcutsEnabled?: boolean;
  serviceTierSupportByProvider?: Record<string, boolean>;
  className?: string;
  fastModeLabel?: string;
  muted?: boolean;
  defaultOpen?: boolean;
  /**
   * Plugin-registered picker entries ("Auto"), rendered as tabs beside the
   * providers. An entry is not a provider: selecting one resolves no catalog,
   * so the model, reasoning and fast-mode rows are replaced by the entry's
   * own description until a provider tab takes the selection back.
   */
  pluginEntries?: readonly PluginExecutionPickerEntrySlot[];
  /**
   * The user's `providerOrder` tokens. Providers and plugin entries share one
   * order under it — see `executionPickerOrderToken`.
   */
  executionOrder?: readonly string[];
  /** The selected entry's order token, or null when a provider is selected. */
  selectedPluginEntryToken?: string | null;
  /**
   * Commit a plugin entry by token, or `null` to hand the selection back to
   * the provider tabs. Omit to hide plugin entries entirely — which is what
   * the plugin-facing `experimental_ProviderModelPicker` does.
   */
  onSelectPluginEntry?: (token: string | null) => void;
  /** Whether the popover blocks page interaction. Defaults to true. */
  modal?: boolean;
  align?: "start" | "center" | "end";
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
  pluginEntries = EMPTY_PLUGIN_ENTRIES,
  executionOrder = EMPTY_EXECUTION_ORDER,
  selectedPluginEntryToken = null,
  onSelectPluginEntry,
  className,
  fastModeLabel,
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
  const navId = useId();
  const listboxId = `${navId}-listbox`;
  const optionDomId = (index: number) => `${navId}-opt-${index}`;

  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null,
  );
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [moreModelsOpen, setMoreModelsOpen] = useState(false);
  const [trackedSelectedProviderId, setTrackedSelectedProviderId] =
    useState(selectedProviderId);

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

  const previewProvider = useMemo(
    () =>
      isPreviewing
        ? previewQuery.data?.providers.find(
            (provider) => provider.id === previewProviderId,
          )
        : undefined,
    [isPreviewing, previewProviderId, previewQuery.data?.providers],
  );
  const previewSelection = useMemo(
    () =>
      isPreviewing
        ? resolveModelCatalogSelection({
            models: previewQuery.data?.models ?? [],
            selectedOnlyModels: previewQuery.data?.selectedOnlyModels ?? [],
            selectedModel: "",
            preferredReasoningLevel: reasoningValue,
            provider: previewProvider,
            catalogIsVerified: previewCatalogIsVerified,
            formatModelLabel: formatModelLabel ?? preserveModelLabel,
          })
        : null,
    [
      formatModelLabel,
      isPreviewing,
      previewCatalogIsVerified,
      previewProvider,
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
  // Plugin entries render only where the host can act on them: a picker that
  // cannot switch providers cannot switch to an entry either.
  const offeredPluginEntries =
    onSelectPluginEntry !== undefined && onSelectedProviderChange !== undefined
      ? pluginEntries
      : EMPTY_PLUGIN_ENTRIES;
  const executionTabs = buildExecutionTabs(
    providerOptions,
    offeredPluginEntries,
    executionOrder,
  );
  const selectedEntry =
    selectedPluginEntryToken === null
      ? null
      : (executionTabs.find(
          (tab) =>
            tab.kind === "plugin-entry" && tab.token === selectedPluginEntryToken,
        ) ?? null);
  // A selected entry whose plugin has gone away leaves no tab behind; the
  // trigger silently falls back to the provider selection, which is the same
  // degradation the submission path applies.
  const selectedEntryRegistration =
    selectedEntry?.kind === "plugin-entry" ? selectedEntry.entry : null;
  const showProviderTabs =
    onSelectedProviderChange !== undefined &&
    executionTabs.length > 1 &&
    (hasMultipleProviders || offeredPluginEntries.length > 0) &&
    (!isShowingModelError ||
      activeModelErrorIsProviderSpecific ||
      selectedEntryRegistration !== null);

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

  const highlightedIndex =
    activeIndex >= 0 && activeIndex < navRows.length ? activeIndex : -1;

  const effectiveShowFastModeToggle =
    hasActiveModelOptions &&
    (serviceTierSupportByProvider
      ? (serviceTierSupportByProvider[activeProviderId] ?? false)
      : showFastModeToggle);
  const effectiveFastModeLabel = isPreviewing
    ? fastServiceTierLabel(previewProvider)
    : (fastModeLabel ?? "Fast");
  const fastModeText = `${effectiveFastModeLabel} mode`;
  const showSelectedFastMode =
    hasSelectedModel && fastModeEnabled && modelOptions.length > 0;
  const showReasoningSection =
    !isShowingModelError &&
    activeReasoningOptions.length > 0 &&
    (isPreviewing
      ? hasActiveModelOptions && !activeModelIsLoading
      : hasSelectedModel && !modelIsLoading && !selectedModelLoadFailed);

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
      setSearchQuery("");
      setActiveIndex(-1);
    },
    [onSelectedProviderChange, open, selectedProviderId],
  );

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
      const pickerPane =
        triggerRef.current?.closest("[data-split-pane-id]") ?? null;
      const caretPane = caretComposer?.closest("[data-split-pane-id]") ?? null;
      return {
        disabled: disabled ?? false,
        isFocusedPane,
        isSplitPane,
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
      if (isPreviewing && previewSelection?.selectedModel) {
        onModelChange(previewSelection.selectedModel);
      }
      onReasoningChange(level);
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

  const handleQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    setActiveIndex(-1);
  }, []);

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

  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = document.getElementById(`${navId}-opt-${highlightedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, navId]);

  useEffect(() => {
    if (!open || isCompactViewport || isPointerCoarse) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, isCompactViewport, isPointerCoarse]);

  const selectedEntryIconName =
    selectedEntryRegistration === null
      ? null
      : pluginEntryIconName(selectedEntryRegistration);
  const TriggerIcon =
    selectedEntryRegistration !== null
      ? undefined
      : hasSelectedModel || modelIsLoading
        ? ProviderIcon
        : undefined;
  const triggerTitleModelLabel = modelIsLoading
    ? "Loading models..."
    : selectedModelLoadFailed
      ? selectedModelLoadErrorText
      : triggerModelLabel;
  // A selected plugin entry replaces the whole provider/model summary: there
  // is no model to name yet, and showing a stale one would claim a decision
  // the gate has not made.
  const entryIsSelected = selectedEntryRegistration !== null;
  const triggerPrimaryLabel = entryIsSelected
    ? selectedEntryRegistration.label
    : triggerModelBase;
  const triggerSecondaryTag = entryIsSelected ? null : triggerModelTag;
  const triggerTrailingLabel = entryIsSelected ? null : triggerReasoningLabel;
  const triggerShowsLoading = modelIsLoading && !entryIsSelected;
  const triggerShowsFastMode = showSelectedFastMode && !entryIsSelected;
  const triggerTitle = entryIsSelected
    ? [
        selectedEntryRegistration.label,
        selectedEntryRegistration.description === undefined
          ? ""
          : ` — ${selectedEntryRegistration.description}`,
      ].join("")
    : [
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
        muted && "font-normal",
        disabled && "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME} title={triggerTitle}>
        {triggerShowsLoading ? (
          <>
            {TriggerIcon ? (
              <TriggerIcon className="size-4 shrink-0" />
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
        ) : selectedEntryIconName !== null ? (
          <Icon name={selectedEntryIconName} className="size-4 shrink-0" aria-hidden />
        ) : triggerShowsFastMode ? (
          <Icon
            name="Zap"
            className="size-3.5 shrink-0 fill-current text-subtle-foreground"
          />
        ) : TriggerIcon ? (
          <TriggerIcon className="size-4 shrink-0" />
        ) : null}
        {triggerShowsLoading ? null : (
          <>
            <span
              className={cn(
                "min-w-0 truncate",
                !entryIsSelected &&
                  triggerModelValueIsDestructive &&
                  "text-destructive-text",
              )}
            >
              {triggerPrimaryLabel}
            </span>
            {triggerSecondaryTag ? (
              <span className="shrink-0 text-subtle-foreground">
                {triggerSecondaryTag}
              </span>
            ) : null}
            {triggerTrailingLabel ? (
              <span
                className="shrink-0 text-subtle-foreground"
                data-promptbox-hide-compact=""
              >
                {triggerTrailingLabel}
              </span>
            ) : null}
          </>
        )}
      </span>
      {disabled ? null : (
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3.5 shrink-0",
            muted ? "text-subtle-foreground/75" : "text-muted-foreground",
          )}
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
            "max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] overflow-hidden",
        )}
      >
        <ResetBrowseStateOnContentUnmount onReset={resetBrowseState} />
        {showProviderTabs ? (
          <div
            className={cn(
              "flex items-center gap-0.5 border-b border-border px-2.5 pt-1",
              isCompactViewport
                ? "sticky top-0 z-10 bg-background"
                : "shrink-0 bg-surface-recessed",
            )}
          >
            {executionTabs.map((tab) => {
              const provider =
                tab.kind === "provider"
                  ? tab.option
                  : {
                      value: tab.token,
                      label: tab.entry.label,
                      icon: undefined,
                    };
              const TabIcon = tab.kind === "provider" ? tab.option.icon : undefined;
              const tabIconName =
                tab.kind === "plugin-entry" ? pluginEntryIconName(tab.entry) : null;
              const isActive =
                tab.kind === "plugin-entry"
                  ? tab.token === selectedPluginEntryToken
                  : selectedPluginEntryToken === null &&
                    provider.value === activeProviderId;
              return (
                <button
                  key={tab.token}
                  type="button"
                  title={
                    tab.kind === "plugin-entry" &&
                    tab.entry.description !== undefined
                      ? `${tab.entry.label} — ${tab.entry.description}`
                      : provider.label
                  }
                  onClick={() => {
                    if (isActive) return;
                    if (tab.kind === "plugin-entry") {
                      onSelectPluginEntry?.(tab.token);
                      return;
                    }
                    // Leaving an entry is a provider commit even when the
                    // provider id is unchanged: the entry, not the provider,
                    // is what the selection has to move off.
                    if (selectedPluginEntryToken !== null) {
                      onSelectPluginEntry?.(null);
                    }
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
                  {tabIconName !== null ? (
                    <Icon
                      name={tabIconName}
                      className={COARSE_POINTER_ICON_SIZE_CLASS}
                      aria-hidden
                    />
                  ) : TabIcon ? (
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

        {entryIsSelected ? (
          // A plugin entry owns the whole body: there is no catalog to browse
          // and no reasoning level to set, because the plugin's gate has not
          // chosen a model yet. Offering the model rows here would let the
          // user set a value the gate is free to overwrite.
          <div className="px-3 py-2.5">
            <p className="text-sm font-medium">
              {selectedEntryRegistration.label}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedEntryRegistration.description ??
                "This plugin chooses the model when you send."}
            </p>
          </div>
        ) : null}

        {showSearchInput && !entryIsSelected ? (
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

        {entryIsSelected ? null : (
        <MenuHoverProvider>
          <div
            className={cn(
              !isCompactViewport &&
                "min-h-0 flex flex-1 flex-col overflow-hidden",
            )}
          >
            <div
              key={activeProviderId || "no-provider"}
              role={showSearchInput ? "listbox" : undefined}
              id={showSearchInput ? listboxId : undefined}
              aria-label={showSearchInput ? "Models" : undefined}
              className={cn(
                "px-1 pb-1 pt-0",
                isCompactViewport
                  ? "overflow-y-auto"
                  : "min-h-0 max-h-64 flex-1 overflow-y-auto overscroll-contain",
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

            {showReasoningSection ? (
              <>
                <div className="shrink-0 border-t border-border" />
                <div className="shrink-0 px-1 pb-1 pt-0">
                  <MenuSectionLabel>Reasoning</MenuSectionLabel>
                  {activeReasoningOptions.map((option) => (
                    <MenuRowButton
                      key={option.value}
                      label={option.label}
                      selected={
                        !isPreviewing && option.value === reasoningValue
                      }
                      disabled={previewSelectionBlocked}
                      onClick={() => handleReasoningSelect(option.value)}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {effectiveShowFastModeToggle ? (
              <>
                <div className="shrink-0 border-t border-border" />
                <div className="shrink-0 p-1">
                  <div className="flex items-center justify-between gap-3 rounded-sm px-2 py-[0.3125rem] text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        name="Zap"
                        className="size-4 fill-current text-muted-foreground"
                      />
                      <span>{fastModeText}</span>
                    </span>
                    <Switch
                      checked={fastModeEnabled}
                      onCheckedChange={onFastModeChange}
                      aria-label={fastModeText}
                      className={LIST_HOVER_TRANSITION}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {footerAction ? (
              <>
                <div className="shrink-0 border-t border-border" />
                <div className="shrink-0 p-1">
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
          </div>
        </MenuHoverProvider>
        )}
      </PopoverContent>
    </Popover>
  );
}

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
  listboxId: string;
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
