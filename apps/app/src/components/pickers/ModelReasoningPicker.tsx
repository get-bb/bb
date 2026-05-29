import { useCallback, useMemo, useState } from "react";
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
}

export function ModelReasoningPicker({
  providerOptions,
  selectedProviderId,
  onSelectedProviderChange,
  hasMultipleProviders,
  modelValue,
  modelOptions,
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
}: ModelReasoningPickerProps) {
  const isCompactViewport = useIsCompactViewport();
  const [open, setOpen] = useState(defaultOpen);
  // While the popover is open, the user can browse other providers without
  // committing. `previewProviderId` tracks which provider tab is active;
  // null means "showing the committed provider".
  const [previewProviderId, setPreviewProviderId] = useState<string | null>(
    null,
  );

  const activeProviderId = previewProviderId ?? selectedProviderId;

  const selectedProvider = providerOptions.find(
    (p) => p.value === selectedProviderId,
  );
  const ProviderIcon = selectedProvider?.icon;
  const selectedModelOption = modelOptions.find((m) => m.value === modelValue);
  const selectedModelLabel = selectedModelOption?.label ?? modelValue;
  const hasSelectedModel = selectedModelLabel.trim().length > 0;
  // Strip the brand prefix at render — the trigger always shows the committed
  // provider, so we use `selectedProviderId` (not `activeProviderId`, which
  // can be a preview).
  const triggerModelLabel = hasSelectedModel
    ? stripModelBrandPrefix(selectedModelLabel, selectedProviderId)
    : "Select model";

  const selectedReasoningOption = reasoningOptions.find(
    (r) => r.value === reasoningValue,
  );
  const triggerReasoningLabel = selectedReasoningOption?.label ?? null;

  const showProviderTabs =
    hasMultipleProviders &&
    onSelectedProviderChange !== undefined &&
    providerOptions.length > 1;

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
  }, [
    isPreviewing,
    modelOptions,
    previewQuery.data?.models,
    formatModelLabel,
  ]);
  const activeModelLoadError = isPreviewing
    ? (previewQuery.data?.modelLoadError ?? null)
    : (modelLoadError ?? null);
  const activeProvider = providerOptions.find(
    (p) => p.value === activeProviderId,
  );
  const activeProviderLabel = activeProvider?.label ?? activeProviderId;
  const activeModelLoadErrorMessage =
    activeModelLoadError?.providerId === activeProviderId
      ? formatModelLoadErrorText({
          error: activeModelLoadError,
          providerLabel: activeProviderLabel,
        })
      : null;
  const activeModelOptions = previewModelOptions;
  const hasActiveModelOptions = activeModelOptions.length > 0;

  // When previewing a different provider, resolve fast-mode toggle from that
  // provider's capabilities instead of the committed provider's.
  const effectiveShowFastModeToggle =
    hasActiveModelOptions &&
    (serviceTierSupportByProvider
      ? (serviceTierSupportByProvider[activeProviderId] ?? false)
      : showFastModeToggle);
  const showSelectedFastMode =
    hasSelectedModel && fastModeEnabled && modelOptions.length > 0;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setPreviewProviderId(null);
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
  const triggerTitle = [
    `${selectedProvider?.label ?? selectedProviderId}: ${triggerModelLabel}`,
    triggerReasoningLabel ? ` · ${triggerReasoningLabel} reasoning` : "",
    showSelectedFastMode ? " (Fast mode)" : "",
  ].join("");

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Provider, model and reasoning"
          title={triggerTitle}
          className={cn(
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            muted && OPTION_MUTED_CLASS_NAME,
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
            <span className="min-w-0 truncate">{triggerModelLabel}</span>
            {triggerReasoningLabel ? (
              <span
                className="shrink-0 text-subtle-foreground"
                data-promptbox-hide-compact=""
              >
                {triggerReasoningLabel}
              </span>
            ) : null}
          </span>
          <Icon
            name="ChevronDown"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
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
            "overflow-y-auto px-1 pb-1",
            !isCompactViewport &&
              "max-h-[min(250px,var(--radix-popover-content-available-height,250px)-80px)]",
          )}
        >
          <MenuSectionLabel>Model</MenuSectionLabel>
          {isPreviewing && previewQuery.isLoading ? (
            <div
              className={cn(
                "px-2 text-xs text-muted-foreground",
                isCompactViewport ? "py-2" : "py-[0.3125rem]",
              )}
            >
              Loading models…
            </div>
          ) : hasActiveModelOptions ? (
            activeModelOptions.map((option) => (
              <MenuRowButton
                key={option.value}
                // The menu always reflects the provider whose models it lists
                // (either committed or previewed) — strip with `activeProviderId`.
                label={stripModelBrandPrefix(option.label, activeProviderId)}
                selected={!isPreviewing && option.value === modelValue}
                onClick={() => handleModelSelect(option.value)}
              />
            ))
          ) : (
            <div
              className={cn(
                "px-2 text-xs text-muted-foreground",
                isCompactViewport ? "py-2" : "py-[0.3125rem]",
              )}
              title={activeModelLoadErrorMessage ?? undefined}
            >
              {activeModelLoadError?.providerId === activeProviderId ? (
                <ModelLoadErrorMessage
                  error={activeModelLoadError}
                  providerLabel={activeProviderLabel}
                />
              ) : (
                "No models available"
              )}
            </div>
          )}
        </div>

        {/* Reasoning section — only shows for the committed model; previewing
            other providers doesn't touch reasoning state, so the committed
            model's reasoning options stay visible. */}
        {reasoningOptions.length > 0 ? (
          <>
            <div className="border-t border-border" />
            <div className="p-1">
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

// `sticky top-0` keeps "Model" pinned to the top of its scrolling parent
// (no-op for "Reasoning" — its parent doesn't scroll). `flex h-7 items-center`
// pins to an integer height so the sticky label doesn't subpixel-shift during
// scroll. Matches DropdownMenuLabel's `text-xs font-medium text-muted-foreground`
// styling for consistency with the rest of the design system.
function MenuSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center bg-background px-2 text-xs font-medium text-muted-foreground">
      {children}
    </div>
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
        {label}
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
