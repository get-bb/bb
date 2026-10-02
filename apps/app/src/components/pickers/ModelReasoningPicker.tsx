import { useSplitPreload } from "@/lib/define-split";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import type {
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@bb/server-contract";
import {
  resolveServiceTierOptions,
  type ProviderOptionDescriptor,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import { useQueryClient } from "@tanstack/react-query";
import {
  stripModelBrandPrefix,
  type ProviderPickerOption,
} from "./model-brand-prefix";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  prefetchSystemExecutionOptions,
  useSystemExecutionOptions,
} from "@/hooks/queries/system-queries";
import { resolveModelCatalogSelection } from "@/hooks/thread-creation-options/model-catalog-selection";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import { type PickerOption } from "./OptionPicker";
import type { ModelPickerOption } from "./model-picker-option";
import {
  MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
  splitModelLabelTag,
} from "./model-picker-menu";
import { ModelReasoningMenu } from "./ModelReasoningMenuSplit";
import { searchPickerOptions } from "./picker-search";
import { useResetPickerScroll } from "./useResetPickerScroll";
import { formatModelLoadErrorText } from "./model-load-error-message";
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

interface ResolvedProviderPreview {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  supportsServiceTier: boolean;
}

export interface ModelReasoningPickerHandoffSelection {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

export interface ModelReasoningPickerHandoff {
  sourceProviderId: string;
  active: boolean;
  onStart: () => void;
  onExit: () => void;
  onSelect: (selection: ModelReasoningPickerHandoffSelection) => void;
}

const FAILED_TO_LOAD_MODELS_LABEL = "Failed to load models";
const EMPTY_MODEL_OPTIONS: readonly ModelPickerOption[] = [];
const EMPTY_SERVICE_TIER_OPTIONS: readonly ProviderOptionDescriptor[] = [];
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

const HANDOFF_DRAWER_TOP_CLASS_NAME =
  "[&>[data-persistent-drawer-handle]]:w-full [&>[data-persistent-drawer-handle]]:rounded-t-xl [&>[data-persistent-drawer-handle]]:bg-background";

export type ModelNavRow =
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
  serviceTierValue: ServiceTier | undefined;
  serviceTierOptions: readonly ProviderOptionDescriptor[];
  onServiceTierChange: (value: ServiceTier) => void;
  commandShortcutsEnabled?: boolean;
  serviceTierSupportByProvider?: Record<string, boolean>;
  className?: string;
  muted?: boolean;
  modal?: boolean;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  handoff?: ModelReasoningPickerHandoff;
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
  serviceTierValue,
  serviceTierOptions,
  onServiceTierChange,
  commandShortcutsEnabled = true,
  serviceTierSupportByProvider,
  className,
  muted,
  modal = true,
  align = "start",
  disabled,
  handoff,
}: ModelReasoningPickerProps) {
  useSplitPreload(ModelReasoningMenu);
  const isCompactViewport = useIsCompactViewport();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const registeredToggleShortcut = useAppCommandShortcut("modelPicker.toggle");
  const toggleShortcut = commandShortcutsEnabled
    ? registeredToggleShortcut
    : null;
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useResetPickerScroll<HTMLDivElement>(searchQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSearching = searchQuery.trim().length > 0;
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
  const [browsingHandoff, setHandoffMode] = useState(false);
  const handoffMode =
    handoff !== undefined && (handoff.active || browsingHandoff);
  const [handoffReasoningLevel, setHandoffReasoningLevel] =
    useState<ReasoningLevel | null>(null);

  if (trackedSelectedProviderId !== selectedProviderId) {
    setTrackedSelectedProviderId(selectedProviderId);
    setHandoffMode(
      open &&
        handoff !== undefined &&
        selectedProviderId !== handoff.sourceProviderId,
    );
    setHandoffReasoningLevel(null);
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
  const queryClient = useQueryClient();
  const prefetchRoutingEnvironmentId = providerRouting?.environmentId;
  const prefetchRoutingHostId = providerRouting?.hostId;
  const siblingIdsKey = providerOptions
    .map((option) => option.value)
    .filter((id) => id !== selectedProviderId)
    .join("\0");
  useEffect(() => {
    if (!open || !canSwitchProviders || siblingIdsKey.length === 0) {
      return;
    }
    prefetchSystemExecutionOptions(queryClient, {
      routing: {
        environmentId: prefetchRoutingEnvironmentId,
        hostId: prefetchRoutingHostId,
      },
      providerIds: siblingIdsKey.split("\0"),
    });
  }, [
    canSwitchProviders,
    open,
    prefetchRoutingEnvironmentId,
    prefetchRoutingHostId,
    queryClient,
    siblingIdsKey,
  ]);
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
  const previewCatalogIsVerified =
    isPreviewing &&
    previewQuery.data !== undefined &&
    !previewQuery.isPlaceholderData &&
    !previewQuery.isError &&
    previewQuery.data.modelLoadError === null;
  const previewSelectionBlocked =
    requireVerifiedProviderPreview && isPreviewing && !previewCatalogIsVerified;

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
  const activeReasoningValue: ReasoningLevel | "" = handoffMode
    ? (handoffReasoningLevel ??
      (isPreviewing ? previewSelection?.reasoningLevel : reasoningValue) ??
      "")
    : isPreviewing
      ? ""
      : reasoningValue;
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
  const activeModelLoadFailed = isPreviewing
    ? previewQuery.isError || activeModelLoadErrorMatches
    : modelLoadFailed || activeModelLoadErrorMatches;
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
    (handoffMode || canSwitchProviders) &&
    providerOptions.length > 1 &&
    (!isShowingModelError || activeModelErrorIsProviderSpecific);

  const activeBrandPrefix = activeProvider?.brandPrefix;
  const filteredModelOptions = useMemo(() => {
    if (!isSearching) {
      return activeModelOptions;
    }
    return searchPickerOptions({
      options: [...activeModelOptions, ...activeMoreModelOptions],
      query: searchQuery,
      getLabel: (option) =>
        stripModelBrandPrefix(option.label, activeBrandPrefix),
      getAliases: (option) =>
        option.routeProviderId
          ? [option.routeProviderId, option.value]
          : [option.value],
    });
  }, [
    activeBrandPrefix,
    activeModelOptions,
    activeMoreModelOptions,
    isSearching,
    searchQuery,
  ]);
  const filteredMoreModelOptions = isSearching
    ? EMPTY_MODEL_OPTIONS
    : activeMoreModelOptions;

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

  const previewActiveModel = previewSelection?.activeModel;
  const previewServiceTierOptions = useMemo(
    () =>
      previewProviderId !== null &&
      (serviceTierSupportByProvider?.[previewProviderId] ?? false)
        ? resolveServiceTierOptions({
            provider: previewProvider,
            model: previewActiveModel,
          })
        : EMPTY_SERVICE_TIER_OPTIONS,
    [
      previewActiveModel,
      previewProvider,
      previewProviderId,
      serviceTierSupportByProvider,
    ],
  );
  const activeServiceTierOptions =
    handoffMode || !hasActiveModelOptions
      ? EMPTY_SERVICE_TIER_OPTIONS
      : isPreviewing
        ? previewServiceTierOptions
        : serviceTierOptions;
  const selectedServiceTierOption =
    hasSelectedModel && modelOptions.length > 0
      ? serviceTierOptions.find((option) => option.id === serviceTierValue)
      : undefined;
  const showReasoningSection =
    !isShowingModelError &&
    activeReasoningOptions.length > 0 &&
    (isPreviewing
      ? hasActiveModelOptions && !activeModelIsLoading
      : hasSelectedModel && !modelIsLoading && !selectedModelLoadFailed);

  const resetBrowseState = useCallback(() => {
    setHandoffMode(false);
    setHandoffReasoningLevel(null);
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

  const toggleShowMoreModels = useCallback(() => {
    setShowMoreModels((current) => !current);
  }, []);

  const handleModelSelect = useCallback(
    (model: string) => {
      if (previewSelectionBlocked) return;
      if (handoff !== undefined && handoffMode) {
        handoff.onSelect({
          providerId: activeProviderId,
          model,
          reasoningLevel:
            handoffReasoningLevel ??
            (isPreviewing ? previewSelection?.reasoningLevel : undefined) ??
            reasoningValue,
        });
        setMoreModelsOpen(false);
        return;
      }
      onModelChange(model);
      setMoreModelsOpen(false);
      setPreviewProviderId(null);
    },
    [
      activeProviderId,
      handoff,
      handoffMode,
      handoffReasoningLevel,
      isPreviewing,
      onModelChange,
      previewSelection,
      previewSelectionBlocked,
      reasoningValue,
    ],
  );

  const handleHandoffProviderSelect = useCallback(
    (providerId: string) => {
      handoff?.onStart();
      setHandoffMode(true);
      setPreviewProviderId(
        providerId === selectedProviderId ? null : providerId,
      );
      setHandoffReasoningLevel(null);
      setShowMoreModels(false);
      setMoreModelsOpen(false);
      setSearchQuery("");
      setActiveIndex(-1);
    },
    [handoff, selectedProviderId],
  );
  const handleProviderSelect = useCallback(
    (providerId: string) => {
      if (
        open &&
        handoff !== undefined &&
        (handoffMode || providerId !== handoff.sourceProviderId)
      ) {
        handleHandoffProviderSelect(providerId);
        return;
      }
      onSelectedProviderChange?.(providerId);
      const nextPreviewProviderId =
        open && providerId !== selectedProviderId ? providerId : null;
      setPreviewProviderId(nextPreviewProviderId);
      setSearchQuery("");
      setActiveIndex(-1);
    },
    [
      handoff,
      handoffMode,
      handleHandoffProviderSelect,
      onSelectedProviderChange,
      open,
      selectedProviderId,
    ],
  );
  const startHandoffMode = useCallback(() => {
    handleHandoffProviderSelect(selectedProviderId);
  }, [handleHandoffProviderSelect, selectedProviderId]);
  const exitHandoffMode = useCallback(() => {
    setHandoffMode(false);
    setHandoffReasoningLevel(null);
    setPreviewProviderId(null);
    setSearchQuery("");
    handoff?.onExit();
  }, [handoff]);

  const handleReasoningSelect = useCallback(
    (level: ReasoningLevel) => {
      if (previewSelectionBlocked) return;
      if (handoffMode) {
        setHandoffReasoningLevel(level);
        if (!isPreviewing) {
          onReasoningChange(level);
        }
        return;
      }
      if (isPreviewing && previewSelection?.selectedModel) {
        onModelChange(previewSelection.selectedModel);
      }
      onReasoningChange(level);
      setPreviewProviderId(null);
      setMoreModelsOpen(false);
    },
    [
      handoffMode,
      isPreviewing,
      previewSelection,
      onModelChange,
      onReasoningChange,
      previewSelectionBlocked,
    ],
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
      const options = handoffMode ? activeModelOptions : modelOptions;
      const value =
        handoffMode && isPreviewing
          ? (previewSelection?.selectedModel ?? "")
          : modelValue;
      const next =
        index === 0
          ? nextCycleValue(options, value)
          : previousCycleValue(options, value);
      if (next !== null) {
        if (handoffMode) {
          handleModelSelect(next);
        } else {
          onModelChange(next);
          setPreviewProviderId(null);
        }
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
      if (handoffMode) {
        const next =
          index === 0
            ? nextCycleValue(providerOptions, activeProviderId)
            : previousCycleValue(providerOptions, activeProviderId);
        if (next !== null) {
          handleHandoffProviderSelect(next);
        }
        return true;
      }
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
      const value = handoffMode ? activeReasoningValue : reasoningValue;
      if (value === "") return true;
      const next = cycleReasoningValue(
        handoffMode ? activeReasoningOptions : reasoningOptions,
        value,
        index === 0 ? "forward" : "backward",
      );
      if (next !== null) {
        if (handoffMode) {
          handleReasoningSelect(next);
        } else {
          onReasoningChange(next);
          setPreviewProviderId(null);
        }
      }
      return true;
    },
    50,
    commandShortcutsEnabled,
  );
  const handleReasoningArrowKeyDown: KeyboardEventHandler<HTMLElement> = (
    event,
  ) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      disabled ||
      !showReasoningSection ||
      previewSelectionBlocked ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }
    if (
      isEditableKeyboardTarget(event.target) &&
      (event.target !== searchInputRef.current || searchQuery.length > 0)
    ) {
      return;
    }
    const index = activeReasoningOptions.findIndex(
      (option) => option.value === activeReasoningValue,
    );
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      activeReasoningOptions[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (next) handleReasoningSelect(next.value);
  };

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
          toggleShowMoreModels();
        }
      }
    },
    [navRows, highlightedIndex, handleModelSelect, toggleShowMoreModels],
  );

  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = document.getElementById(`${navId}-opt-${highlightedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, navId]);

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
    selectedServiceTierOption
      ? ` (${selectedServiceTierOption.label} mode)`
      : "",
  ].join("");
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
      {...ModelReasoningMenu.intentProps}
      onKeyDown={handleReasoningArrowKeyDown}
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
        {modelIsLoading ? (
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
        ) : selectedServiceTierOption ? (
          <Icon
            name="Zap"
            className="size-3.5 shrink-0 fill-current text-subtle-foreground"
          />
        ) : TriggerIcon ? (
          <TriggerIcon className="size-4 shrink-0" />
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
        mobileTitle={handoffMode ? "Handoff to new thread" : "Model"}
        mobileClassName={
          handoffMode ? HANDOFF_DRAWER_TOP_CLASS_NAME : undefined
        }
        onKeyDown={handleReasoningArrowKeyDown}
        onMobileContentAnimationEnd={handleMobileContentAnimationEnd}
        autoFocusRef={showSearchInput ? searchInputRef : undefined}
        className={cn(
          "flex min-h-0 flex-col p-0",
          MODEL_PICKER_MENU_WIDTH_CLASS_NAME,
          isCompactViewport
            ? "overflow-y-hidden"
            : "max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] overflow-hidden",
        )}
      >
        <ResetBrowseStateOnContentUnmount onReset={resetBrowseState} />
        {handoffMode ? <HandoffModeHeader onBack={exitHandoffMode} /> : null}
        {showProviderTabs ? (
          <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background px-2.5 pt-1">
            {providerOptions.map((provider) => {
              const TabIcon = provider.icon;
              const isActive = provider.value === activeProviderId;
              const isHandoffSource =
                handoffMode &&
                handoff !== undefined &&
                provider.value === handoff.sourceProviderId;
              return (
                <button
                  key={provider.value}
                  type="button"
                  title={
                    isHandoffSource
                      ? `${provider.label} (current thread)`
                      : provider.label
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (provider.value === activeProviderId) {
                      return;
                    }
                    handleProviderSelect(provider.value);
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

        <ModelReasoningMenu
          listRef={listRef}
          providerId={activeProviderId}
          provider={activeProvider}
          providerLabel={activeProviderLabel}
          listboxId={showSearchInput ? listboxId : undefined}
          optionId={optionDomId}
          modelIsLoading={activeModelIsLoading}
          isShowingModelError={isShowingModelError}
          hasModelOptions={hasActiveModelOptions}
          modelLoadError={
            activeModelLoadErrorMatches ? activeModelLoadError : null
          }
          modelLoadFailed={activeModelLoadFailed}
          navRows={navRows}
          highlightedIndex={highlightedIndex}
          isSearching={isSearching}
          showMoreModels={showMoreModels}
          onToggleMoreModels={toggleShowMoreModels}
          moreModelOptions={filteredMoreModelOptions}
          moreModelsOpen={moreModelsOpen}
          onMoreModelsOpenChange={setMoreModelsOpen}
          isPreviewing={isPreviewing}
          modelValue={modelValue}
          selectionBlocked={previewSelectionBlocked}
          onModelSelect={handleModelSelect}
          showReasoningSection={showReasoningSection}
          reasoningValue={activeReasoningValue}
          reasoningOptions={activeReasoningOptions}
          onReasoningSelect={handleReasoningSelect}
          serviceTierOptions={activeServiceTierOptions}
          serviceTierValue={serviceTierValue}
          onServiceTierChange={onServiceTierChange}
          onStartHandoff={
            handoff !== undefined && !handoffMode && providerOptions.length > 0
              ? startHandoffMode
              : null
          }
        />
      </PopoverContent>
    </Popover>
  );
}

function HandoffModeHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 bg-background px-2 pb-1 pt-1.5">
      <button
        type="button"
        aria-label="Exit handoff"
        onClick={onBack}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
          LIST_HOVER_TRANSITION,
        )}
      >
        <Icon name="X" className="size-3.5" aria-hidden />
      </button>
      <span className="min-w-0 truncate text-xs font-normal text-subtle-foreground">
        Handoff to new thread
      </span>
    </div>
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
          className="h-7 border-0 bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-subtle-foreground shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}
