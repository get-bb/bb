import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SystemProvidersQuery } from "@bb/server-contract";
import type {
  ExperimentalProviderModelPickerProps,
  ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import {
  formatModelLabel,
  useThreadCreationOptions,
} from "@/hooks/useThreadCreationOptions";

function selectionKey(value: ExperimentalProviderModelPickerValue): string {
  return [
    value.providerId,
    value.model,
    value.reasoningLevel,
    value.serviceTier ?? "",
  ].join("\0");
}

/**
 * Controlled SDK adapter over the same picker and selection controller used
 * by bb's composers. Provider previews stay inside ModelReasoningPicker; only
 * its verified, fully-resolved default is allowed across the public boundary.
 */
export function PluginProviderModelPicker({
  value,
  onChange,
  hostId,
  className,
}: ExperimentalProviderModelPickerProps) {
  const controlledKey = `${hostId ?? ""}\0${selectionKey(value)}`;
  const pendingModelCommitRef = useRef(false);
  const routing = useMemo<SystemProvidersQuery>(
    () => (hostId === undefined ? {} : { hostId }),
    [hostId],
  );
  const controller = useThreadCreationOptions({
    scope: "component-local",
    initialProviderId: value.providerId,
    initialModel: value.model,
    initialReasoningLevel: value.reasoningLevel,
    initialServiceTier: value.serviceTier,
    resetKey: controlledKey,
    resolveProviderRouting: () => routing,
  });

  const emit = useCallback(
    (next: ExperimentalProviderModelPickerValue) => {
      if (selectionKey(next) !== selectionKey(value)) {
        onChange(next);
      }
    },
    [onChange, value],
  );

  useEffect(() => {
    if (
      !pendingModelCommitRef.current ||
      !controller.modelCatalogIsVerified ||
      controller.selectedModel.length === 0
    ) {
      return;
    }
    pendingModelCommitRef.current = false;
    emit({
      providerId: controller.selectedProviderId,
      model: controller.selectedModel,
      reasoningLevel: controller.reasoningLevel,
      ...(controller.serviceTier === undefined
        ? {}
        : { serviceTier: controller.serviceTier }),
    });
  }, [
    controller.modelCatalogIsVerified,
    controller.reasoningLevel,
    controller.selectedModel,
    controller.selectedProviderId,
    controller.serviceTier,
    emit,
  ]);

  const handleModelChange = useCallback(
    (model: string) => {
      if (!controller.modelCatalogIsVerified) return;
      pendingModelCommitRef.current = true;
      controller.setSelectedModel(model);
    },
    [controller],
  );
  const handleReasoningChange = useCallback(
    (
      reasoningLevel: ExperimentalProviderModelPickerValue["reasoningLevel"],
    ) => {
      if (!controller.modelCatalogIsVerified) return;
      emit({
        providerId: controller.selectedProviderId,
        model: controller.selectedModel,
        reasoningLevel,
        ...(controller.serviceTier === undefined
          ? {}
          : { serviceTier: controller.serviceTier }),
      });
    },
    [controller, emit],
  );
  const handleFastModeChange = useCallback(
    (enabled: boolean) => {
      if (
        !controller.modelCatalogIsVerified ||
        !controller.supportsServiceTier
      ) {
        return;
      }
      emit({
        providerId: controller.selectedProviderId,
        model: controller.selectedModel,
        reasoningLevel: controller.reasoningLevel,
        serviceTier: enabled ? "fast" : "default",
      });
    },
    [controller, emit],
  );
  const handleProviderPreviewResolved = useCallback(
    (selection: {
      providerId: string;
      model: string;
      reasoningLevel: ExperimentalProviderModelPickerValue["reasoningLevel"];
      supportsServiceTier: boolean;
    }) => {
      emit({
        providerId: selection.providerId,
        model: selection.model,
        reasoningLevel: selection.reasoningLevel,
        ...(selection.supportsServiceTier && value.serviceTier !== undefined
          ? { serviceTier: value.serviceTier }
          : {}),
      });
    },
    [emit, value.serviceTier],
  );

  return (
    <ModelReasoningPicker
      key={controlledKey}
      providerOptions={controller.providerOptions}
      providerRouting={controller.executionOptionsRouting}
      selectedProviderId={controller.selectedProviderId}
      onSelectedProviderChange={() => {}}
      onProviderPreviewResolved={handleProviderPreviewResolved}
      requireVerifiedProviderPreview
      hasMultipleProviders={controller.hasMultipleProviders}
      modelValue={controller.selectedModel}
      modelOptions={controller.modelOptions}
      moreModelOptions={controller.moreModelOptions}
      modelIsLoading={controller.isLoadingModels}
      modelLoadFailed={controller.modelLoadFailed}
      modelLoadError={controller.modelLoadError}
      onModelChange={handleModelChange}
      formatModelLabel={formatModelLabel}
      reasoningValue={controller.reasoningLevel}
      reasoningOptions={controller.reasoningOptions}
      onReasoningChange={handleReasoningChange}
      fastModeEnabled={controller.serviceTier === "fast"}
      onFastModeChange={handleFastModeChange}
      showFastModeToggle={controller.supportsServiceTier}
      serviceTierSupportByProvider={controller.serviceTierSupportByProvider}
      commandShortcutsEnabled={false}
      className={className}
    />
  );
}
