import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import type { ReasoningLevel } from "@bb/domain";
import { stripModelBrandPrefix } from "./model-brand-prefix";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_PROVIDER_TAB_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { Switch } from "@/components/ui/switch.js";
import { cn } from "@/lib/utils";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport.js";
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
}: ModelReasoningPickerProps) {
  const isCompactViewport = useIsCompactViewport();
  const [open, setOpen] = useState(defaultOpen);
  // While the popover is open, the user can browse other providers without
  // committing. `previewProviderId` tracks which provider tab is active;
  // null means "showing the committed provider".
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null,
  );
  // "More models" expansion is per-open: it resets when the popover closes.
  const [showMoreModels, setShowMoreModels] = useState(false);

  const activeProviderId = previewProviderId ?? selectedProviderId;

  const selectedProvider = providerOptions.find(
    (p) => p.value === selectedProviderId,
  );
  const ProviderIcon = selectedProvider?.icon;
  const selectedModelOption = modelOptions.find((m) => m.value === modelValue);
  const selectedModelLabel = selectedModelOption?.label ?? modelValue;
  const hasSelectedModel =
    modelOptions.length > 0 && selectedModelLabel.trim().length > 0;
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
  const previewMoreModelOptions = useMemo((): readonly PickerOption<string>[] => {
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
    hasSelectedModel && !modelIsLoading && !selectedModelLoadFailed;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setPreviewProviderId(null);
      setShowMoreModels(false);
    }
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
      setOpen(false);
      setPreviewProviderId(null);
    },
    [isPreviewing, onModelChange, onSelectedProviderChange, previewProviderId],
  );

  const handleReasoningSelect = useCallback(
    (level: ReasoningLevel) => {
      onReasoningChange(level);
      // Match the standalone Reasoning OptionPicker's behaviour: picking a
      // value commits and closes. Provider preview is also discarded since
      // the user moved their attention to reasoning.
      setOpen(false);
      setPreviewProviderId(null);
    },
    [onReasoningChange],
  );

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
      title={triggerTitle}
      disabled={disabled}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        muted && OPTION_MUTED_CLASS_NAME,
        disabled && "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
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

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        mobileTitle="Model"
        className="flex w-52 flex-col p-0 max-md:w-full max-md:max-w-none"
      >
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
                    }
                  }}
                  className={cn(
                    "flex items-center justify-center border-b-2 transition-colors focus-visible:outline-none",
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

        {/* Model list */}
        <div
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
              {activeModelOptions.map((option) => (
                <MenuRowButton
                  key={option.value}
                  // The menu always reflects the provider whose models it lists
                  // (either committed or previewed) — strip with `activeProviderId`.
                  label={stripModelBrandPrefix(option.label, activeProviderId)}
                  selected={!isPreviewing && option.value === modelValue}
                  onClick={() => handleModelSelect(option.value)}
                />
              ))}
              {activeMoreModelOptions.length > 0 ? (
                <MoreModelsToggleRow
                  expanded={showMoreModels}
                  onToggle={() => setShowMoreModels((current) => !current)}
                />
              ) : null}
              {showMoreModels
                ? activeMoreModelOptions.map((option) => (
                    <MenuRowButton
                      key={option.value}
                      label={stripModelBrandPrefix(
                        option.label,
                        activeProviderId,
                      )}
                      selected={!isPreviewing && option.value === modelValue}
                      onClick={() => handleModelSelect(option.value)}
                    />
                  ))
                : null}
            </>
          ) : (
            <div
              className={cn(
                "px-2 text-xs text-muted-foreground",
                isCompactViewport ? "py-2" : "py-[0.3125rem]",
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

        {/* Reasoning section — only shows for the committed model; previewing
            other providers doesn't touch reasoning state, so the committed
            model's reasoning options stay visible. */}
        {showReasoningSection && reasoningOptions.length > 0 ? (
          <>
            <div className="border-t border-border" />
            <div className="px-1 pb-1 pt-0">
              <MenuSectionLabel>Reasoning</MenuSectionLabel>
              {reasoningOptions.map((option) => (
                <MenuRowButton
                  key={option.value}
                  label={option.label}
                  selected={option.value === reasoningValue}
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
                />
              </div>
            </div>
          </>
        ) : null}
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

// Disclosure row for the collapsed secondary model pool. Same row metrics as
// MenuRowButton so the list reads as one column; muted to read as an
// affordance rather than a model.
function MoreModelsToggleRow({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const isCompactViewport = useIsCompactViewport();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-1 rounded-sm px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-state-hover hover:text-foreground",
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
    >
      <span>{expanded ? "Fewer models" : "More models"}</span>
      <Icon
        name={expanded ? "ChevronUp" : "ChevronDown"}
        className="size-3.5 shrink-0"
      />
    </button>
  );
}

function MenuRowButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const isCompactViewport = useIsCompactViewport();
  const { base, tag } = splitModelLabelTag(label);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 text-xs outline-none transition-colors hover:bg-state-hover hover:text-foreground",
        isCompactViewport ? "py-2" : "py-[0.3125rem]",
      )}
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
