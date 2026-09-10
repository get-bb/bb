import { useState, type ReactNode } from "react";
import { isDecimalIntegerString } from "@bb/config/voice-transcription-limit";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import type { SystemTranscriptionSettingsUpdate } from "@bb/server-contract";
import {
  getCollapsibleHeaderToneClass,
  CollapsibleHeader,
} from "@/components/ui/disclosure";
import {
  SettingsBadge,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import {
  useAudioInputDevices,
  type AudioInputDeviceOption,
} from "@/hooks/useAudioInputDevices";
import { invalidateVoiceLocalModels } from "@/hooks/cache-owners/voice-cache-owner";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { voiceLocalModelsQueryKey } from "@/hooks/queries/query-keys";
import { useUpdateTranscriptionSettings } from "@/hooks/mutations/settings-mutations";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { fetchWithAppSurface } from "@/lib/app-surface";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  useAudioInputDevicePreference,
  type PreferredAudioInputDeviceId,
} from "@/lib/audio-input-device-preference";

export interface VoiceTranscriptionServiceStatus {
  id: string;
  displayName: string;
  pluginId: string;
}

export interface VoiceTranscriptionStatus {
  model: string;
  enabled: boolean;
  ceilingBytes: number;
  timeoutMaxMs: number;
  recordingBitrate: number;
  voiceServices: readonly VoiceTranscriptionServiceStatus[];
}

type OnUpdateTranscription = (
  update: SystemTranscriptionSettingsUpdate,
) => void;

interface VoiceInputSettingsSectionContentProps {
  devices: readonly AudioInputDeviceOption[];
  errorMessage: string | null;
  isLoading: boolean;
  isSupported: boolean;
  onDeviceChange: (deviceId: PreferredAudioInputDeviceId) => void;
  onRefresh: (requestPermission: boolean) => void;
  preferredDeviceId: PreferredAudioInputDeviceId;
  transcription?: VoiceTranscriptionStatus;
  onUpdateTranscription?: OnUpdateTranscription;
  isSavingTranscription?: boolean;
  localModelsSlot?: ReactNode;
}

const SETTINGS_DROPDOWN_TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const SETTINGS_DROPDOWN_CONTENT_CLASS =
  "min-w-[var(--radix-dropdown-menu-trigger-width)]";
const SYSTEM_DEFAULT_MICROPHONE_LABEL = "System default";
const MICROPHONE_SETTING_LABEL = "Microphone";

function selectedMicrophoneLabel({
  devices,
  isSupported,
  preferredDeviceId,
}: {
  devices: readonly AudioInputDeviceOption[];
  isSupported: boolean;
  preferredDeviceId: PreferredAudioInputDeviceId;
}): string {
  if (!isSupported) {
    return "Unsupported";
  }
  if (preferredDeviceId === null) {
    return SYSTEM_DEFAULT_MICROPHONE_LABEL;
  }
  return (
    devices.find((device) => device.deviceId === preferredDeviceId)?.label ??
    "Unavailable microphone"
  );
}

function microphoneSettingDescription({
  devices,
  errorMessage,
  isLoading,
  isSupported,
  preferredDeviceId,
}: {
  devices: readonly AudioInputDeviceOption[];
  errorMessage: string | null;
  isLoading: boolean;
  isSupported: boolean;
  preferredDeviceId: PreferredAudioInputDeviceId;
}): string {
  if (!isSupported) {
    return "This browser does not expose microphone devices.";
  }
  if (isLoading) {
    return "Loading microphones.";
  }
  if (errorMessage !== null) {
    return errorMessage;
  }
  if (
    preferredDeviceId !== null &&
    devices.every((device) => device.deviceId !== preferredDeviceId)
  ) {
    return "Selected microphone is unavailable.";
  }
  if (devices.length === 0) {
    return "No microphones found.";
  }
  return "Used for prompt voice input.";
}

const MB = 1024 * 1024;
/**
 * Recording-limit choices offered in Settings, within the 10MB overall voice
 * cap the plugin transport can carry.
 */
const AUDIO_LIMIT_MB_OPTIONS = [2, 5, 10] as const;
const TIMEOUT_MIN_S = 10;
const TIMEOUT_MAX_S = 900;
const BITRATE_KBPS_OPTIONS = [24, 32, 64, 128] as const;

const NUMBER_INPUT_CLASS = "h-7 w-20 text-right text-xs";

export const LOCAL_TRANSCRIPTION_PROVIDER_ID = "local";
export const LOCAL_TRANSCRIPTION_MODEL = "local/parakeet-v2";
export const CODEX_TRANSCRIPTION_PROVIDER_ID = "codex";
export const CODEX_TRANSCRIPTION_MODEL = "codex/gpt-transcribe";

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  [CODEX_TRANSCRIPTION_PROVIDER_ID]: CODEX_TRANSCRIPTION_MODEL,
  [LOCAL_TRANSCRIPTION_PROVIDER_ID]: LOCAL_TRANSCRIPTION_MODEL,
};

export interface TranscriptionProviderOption {
  provider: string;
  label: string;
}

/**
 * Provider dropdown options derived from the voice services actually
 * registered by loaded plugins — never a hardcoded universe. A provider with
 * no registered service simply has no option, instead of a dead entry.
 */
export function transcriptionProviderOptions(
  transcription: VoiceTranscriptionStatus,
): TranscriptionProviderOption[] {
  return transcription.voiceServices.map((service) => ({
    provider: service.id,
    label: service.displayName,
  }));
}

function approxMinutesText(ceilingBytes: number, bitrateBps: number): string {
  if (bitrateBps <= 0) {
    return "";
  }
  const minutes = Math.max(
    1,
    Math.round((ceilingBytes * 8) / bitrateBps / 60),
  );
  return `About ${minutes} minutes at the current limit.`;
}

function splitModel(model: string): { provider: string; modelId: string } {
  const separator = model.indexOf("/");
  if (separator < 0) {
    return { provider: model, modelId: "" };
  }
  return {
    provider: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

export function composeModelForProvider(
  nextProvider: string,
  currentModel: string,
): string | null {
  const { provider, modelId } = splitModel(currentModel);
  if (nextProvider === provider) {
    return currentModel;
  }
  const knownDefault = PROVIDER_DEFAULT_MODELS[nextProvider];
  if (knownDefault !== undefined) {
    return knownDefault;
  }
  // Carry the model id across to a third provider instead of clobbering it.
  // With no model id there is nothing valid to compose, so report that rather
  // than writing a broken value or silently doing nothing.
  if (modelId.length > 0) {
    return `${nextProvider}/${modelId}`;
  }
  return null;
}

function TranscriptionProviderControl({
  transcription,
  options,
  onUpdate,
  disabled,
}: {
  transcription: VoiceTranscriptionStatus;
  options: TranscriptionProviderOption[];
  onUpdate: OnUpdateTranscription;
  disabled: boolean;
}) {
  const { provider } = splitModel(transcription.model);
  const activeLabel =
    options.find((option) => option.provider === provider)?.label ??
    (provider.length > 0 ? provider : "Select provider");

  function select(nextProvider: string): void {
    const nextModel = composeModelForProvider(nextProvider, transcription.model);
    if (nextModel !== null && nextModel !== transcription.model) {
      onUpdate({ transcriptionModel: nextModel });
    }
  }

  return (
    <SettingsWithControl
      label="Transcription provider"
      description="Who turns your voice into text. Codex runs in the cloud, Local runs on this machine."
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label="Transcription provider"
            disabled={disabled}
          >
            <span className="min-w-0 truncate">{activeLabel}</span>
            <Icon
              name="ChevronDown"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={SETTINGS_DROPDOWN_CONTENT_CLASS}
          mobileTitle="Transcription provider"
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.provider}
              onSelect={() => select(option.provider)}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  provider !== option.provider && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

interface SettingOption {
  value: number;
  label: string;
}

function OptionSettingControl({
  label,
  description,
  ariaLabel,
  options,
  currentValue,
  currentLabel,
  disabled,
  onCommit,
}: {
  label: string;
  description: ReactNode;
  ariaLabel: string;
  options: readonly SettingOption[];
  currentValue: number;
  currentLabel: string;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <SettingsWithControl label={label} description={description}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
            aria-label={ariaLabel}
            disabled={disabled}
          >
            <span className="min-w-0 truncate">{currentLabel}</span>
            <Icon
              name="ChevronDown"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={SETTINGS_DROPDOWN_CONTENT_CLASS}
          mobileTitle={label}
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => {
                if (option.value !== currentValue) {
                  onCommit(option.value);
                }
              }}
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  option.value !== currentValue && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

function NumericSettingControl({
  label,
  description,
  ariaLabel,
  unitSuffix,
  currentValue,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  description: string;
  ariaLabel: string;
  unitSuffix: string;
  currentValue: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(currentValue));
  const [error, setError] = useState<string | null>(null);

  function validate(raw: string): string | null {
    if (!isDecimalIntegerString(raw)) {
      return `Enter a whole number of ${unitSuffix}.`;
    }
    const parsed = Number(raw.trim());
    if (parsed < min || parsed > max) {
      return `Must be between ${min} and ${max} ${unitSuffix}.`;
    }
    return null;
  }

  function commit(): void {
    const nextError = validate(text);
    setError(nextError);
    if (nextError !== null) {
      return;
    }
    const parsed = Number(text.trim());
    if (parsed !== currentValue) {
      onCommit(parsed);
    }
  }

  return (
    <SettingsWithControl label={label} description={description}>
      <div className="flex flex-col items-stretch gap-1 sm:items-end">
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            inputMode="numeric"
            className={NUMBER_INPUT_CLASS}
            value={text}
            aria-label={ariaLabel}
            aria-invalid={error !== null}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              setError(validate(event.target.value));
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
          />
          <span className="text-xs text-muted-foreground">{unitSuffix}</span>
        </div>
        {error ? (
          <p role="alert" className="text-2xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsWithControl>
  );
}

function AdvancedTranscriptionControls({
  transcription,
  onUpdate,
  isSaving,
}: {
  transcription: VoiceTranscriptionStatus;
  onUpdate: OnUpdateTranscription;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ceilingMb = Math.round(transcription.ceilingBytes / MB);
  const timeoutSeconds = Math.round(transcription.timeoutMaxMs / 1000);
  const bitrateKbps = Math.round(transcription.recordingBitrate / 1000);

  return (
    <div className="space-y-3">
      <CollapsibleHeader
        summaryContent="Advanced"
        toneClassName={getCollapsibleHeaderToneClass(open)}
        isExpanded={open}
        forceChevronVisible
        onToggle={() => setOpen((value) => !value)}
      />
      {open ? (
        <div className="space-y-4">
          <OptionSettingControl
            label="Recording limit"
            description="How large a recording can be before it is rejected."
            ariaLabel="Recording limit"
            options={AUDIO_LIMIT_MB_OPTIONS.map((mb) => ({
              value: mb,
              label: `${mb} MB`,
            }))}
            currentValue={ceilingMb}
            currentLabel={`${ceilingMb} MB`}
            disabled={isSaving}
            onCommit={(mb) => onUpdate({ transcriptionMaxBytes: mb * MB })}
          />
          <NumericSettingControl
            key={`timeout-${transcription.timeoutMaxMs}`}
            label="Transcription timeout"
            description="Times out if transcription does not respond by that time."
            ariaLabel="Transcription timeout in seconds"
            unitSuffix="s"
            currentValue={timeoutSeconds}
            min={TIMEOUT_MIN_S}
            max={TIMEOUT_MAX_S}
            disabled={isSaving}
            onCommit={(seconds) =>
              onUpdate({ transcriptionTimeoutMaxMs: seconds * 1000 })
            }
          />
          <OptionSettingControl
            label="Recording quality"
            description={`Affects the quality of your transcription. ${approxMinutesText(transcription.ceilingBytes, transcription.recordingBitrate)}`}
            ariaLabel="Recording quality"
            options={BITRATE_KBPS_OPTIONS.map((kbps) => ({
              value: kbps,
              label: `${kbps} kbps`,
            }))}
            currentValue={bitrateKbps}
            currentLabel={`${bitrateKbps} kbps`}
            disabled={isSaving}
            onCommit={(kbps) => onUpdate({ recordingBitrate: kbps * 1000 })}
          />
        </div>
      ) : null}
    </div>
  );
}

const LOCAL_PLUGIN_MISSING_FALLBACK =
  "Local transcription needs the local-transcribe plugin, which isn't installed. Install the plugin, then download a model here.";
const LOCAL_MODELS_ERROR_FALLBACK =
  "Couldn't load local models from the local-transcribe plugin.";

const localModelSchema = z.object({  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  infoUrl: z.string().optional(),
  downloadBytes: z.number().optional(),
  state: z.string(),
  error: z.string().optional(),
  progressPercent: z.number().optional(),
});
const localModelsResponseSchema = z.object({
  models: z.array(localModelSchema),
});
type LocalModel = z.infer<typeof localModelSchema>;

function LocalSetupFallback({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-snug text-subtle-foreground/75">
      {message}
    </div>
  );
}

function ModelIconButton({
  label,
  tooltip,
  icon,
  onClick,
  disabled,
  destructive = false,
}: {
  label: string;
  tooltip: string;
  icon: "Download" | "Trash2";
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip delayDuration={300} disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 shrink-0 text-muted-foreground hover:text-foreground",
            destructive && "hover:text-destructive",
          )}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon name={icon} className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ModelCardLink({ url }: { url?: string }) {
  if (!url) {
    return null;
  }
  return (
    <button
      type="button"
      className="mt-0.5 inline-flex min-w-0 items-center gap-1 text-xs text-subtle-foreground/75 hover:text-foreground hover:underline"
      onClick={() => openUrlInExternalBrowser(url)}
      aria-label="Open model card on Hugging Face"
    >
      <span className="truncate">Model card</span>
      <Icon name="ExternalLink" className="size-3 shrink-0" />
    </button>
  );
}

function LocalModelRow({
  model,
  isActive,
  onSelect,
  onDownload,
  onRemove,
  isStarting,
  isRemoving,
}: {
  model: LocalModel;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDownload: (id: string) => void;
  onRemove: (id: string) => void;
  isStarting: boolean;
  isRemoving: boolean;
}) {
  function action(): ReactNode {
    if (model.state === "ready") {
      // The selected model shows a checkmark instead of actions: it cannot
      // be deleted while in use, so switch first to delete it.
      if (isActive) {
        return null;
      }
      return (
        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => onSelect(model.id)}
          >
            Use
          </Button>
          <ModelIconButton
            label={`Delete ${model.displayName}`}
            tooltip="Delete model"
            icon="Trash2"
            destructive
            disabled={isRemoving}
            onClick={() => onRemove(model.id)}
          />
        </span>
      );
    }
    if (model.state === "downloading") {
      return (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Spinner" className="size-3.5 animate-spin" />
          {typeof model.progressPercent === "number"
            ? `${Math.round(model.progressPercent)}%`
            : "Downloading…"}
        </span>
      );
    }
    if (model.state === "failed") {
      return (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="max-w-44 truncate text-xs text-destructive" title={model.error ?? "Download failed"}>
            {model.error ?? "Download failed"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={isStarting}
            onClick={() => onDownload(model.id)}
          >
            <Icon name="Download" className="size-3.5" />
            Retry
          </Button>
        </span>
      );
    }
    if (model.state === "missing") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={isStarting}
          onClick={() => onDownload(model.id)}
        >
          <Icon name="Download" className="size-3.5" />
          Download
        </Button>
      );
    }
    return (
      <SettingsBadge>{model.state.length > 0 ? model.state : "—"}</SettingsBadge>
    );
  }

  const selected = model.state === "ready" && isActive;
  return (
    <li className="flex items-center gap-2.5 px-3 py-2.5">
      {selected ? (
        <span role="img" aria-label="Selected model" className="shrink-0">
          <Icon name="Check" className="size-4 text-success" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-normal text-foreground">
          {model.displayName}
        </span>
        <ModelCardLink url={model.infoUrl} />
      </span>
      {action()}
    </li>
  );
}

export function LocalModelsSubsection({
  pluginId,
  activeModelId,
  onSelectModel,
}: {
  pluginId: string | null;
  activeModelId?: string | null;
  onSelectModel?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: pluginId !== null,
    queryKey: voiceLocalModelsQueryKey(pluginId ?? ""),
    queryFn: async () => {
      const raw = await callPluginRpc(
        fetchWithAppSurface,
        pluginId ?? "",
        "models_list",
        null,
      );
      return localModelsResponseSchema.parse(raw);
    },
    refetchInterval: (queryState) =>
      queryState.state.data?.models.some(
        (model) => model.state === "downloading",
      )
        ? 2_000
        : false,
  });
  const setup = useMutation({
    meta: { errorMessage: "Failed to start the local model download." },
    mutationFn: (id: string) =>
      callPluginRpc(fetchWithAppSurface, pluginId ?? "", "models_setup", {
        id,
      }),
    onSuccess: () => {
      if (pluginId !== null) {
        invalidateVoiceLocalModels({ pluginId, queryClient });
      }
    },
  });
  const remove = useMutation({
    meta: { errorMessage: "Failed to delete the local model." },
    mutationFn: (id: string) =>
      callPluginRpc(fetchWithAppSurface, pluginId ?? "", "models_remove", {
        id,
      }),
    onSuccess: () => {
      if (pluginId !== null) {
        invalidateVoiceLocalModels({ pluginId, queryClient });
      }
    },
  });

  function body(): ReactNode {
    if (pluginId === null) {
      return <LocalSetupFallback message={LOCAL_PLUGIN_MISSING_FALLBACK} />;
    }
    if (query.isError) {
      return <LocalSetupFallback message={LOCAL_MODELS_ERROR_FALLBACK} />;
    }
    if (!query.isSuccess) {
      return (
        <p className="text-xs text-subtle-foreground/75">
          Checking local models…
        </p>
      );
    }
    if (query.data.models.length === 0) {
      return (
        <LocalSetupFallback message="No local models are available to download yet." />
      );
    }
    return (
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-muted/30">
        {query.data.models.map((model) => (
          <LocalModelRow
            key={model.id}
            model={model}
            isActive={activeModelId === model.id}
            onSelect={(id) => onSelectModel?.(id)}
            onDownload={(id) => setup.mutate(id)}
            onRemove={(id) => remove.mutate(id)}
            isStarting={setup.isPending && setup.variables === model.id}
            isRemoving={remove.isPending && remove.variables === model.id}
          />
        ))}
      </ul>
    );
  }

  const readyCount = query.data?.models.filter(
    (model) => model.state === "ready",
  ).length;
  const totalCount = query.data?.models.length ?? 0;

  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="text-sm font-normal text-foreground">Local models</p>
        {query.isSuccess ? (
          <SettingsBadge>
            {`${readyCount ?? 0}/${totalCount} downloaded`}
          </SettingsBadge>
        ) : null}
      </div>
      {body()}
    </div>
  );
}

export function VoiceInputSettingsSectionContent({
  devices,
  errorMessage,
  isLoading,
  isSupported,
  onDeviceChange,
  onRefresh,
  preferredDeviceId,
  transcription,
  onUpdateTranscription,
  isSavingTranscription = false,
  localModelsSlot,
}: VoiceInputSettingsSectionContentProps) {
  const triggerLabel = selectedMicrophoneLabel({
    devices,
    isSupported,
    preferredDeviceId,
  });
  const showTranscription =
    transcription !== undefined && onUpdateTranscription !== undefined;
  const isLocalProvider =
    transcription !== undefined &&
    splitModel(transcription.model).provider === LOCAL_TRANSCRIPTION_PROVIDER_ID;

  return (
    <SettingsSection
      title="Voice Input"
      actionPlacement="inline"
      action={
        <Tooltip delayDuration={300} disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              disabled={!isSupported || isLoading}
              onClick={() => onRefresh(true)}
              aria-label={
                isLoading ? "Loading microphones" : "Load microphones"
              }
            >
              <Icon
                name="RotateCcw"
                className={cn("size-3.5", isLoading && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Load microphones</TooltipContent>
        </Tooltip>
      }
      bodyClassName="space-y-4"
    >
      <SettingsWithControl
        label={MICROPHONE_SETTING_LABEL}
        description={microphoneSettingDescription({
          devices,
          errorMessage,
          isLoading,
          isSupported,
          preferredDeviceId,
        })}
      >
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) {
              onRefresh(false);
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={SETTINGS_DROPDOWN_TRIGGER_CLASS}
              aria-label={MICROPHONE_SETTING_LABEL}
              disabled={!isSupported}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="Mic" className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{triggerLabel}</span>
              </span>
              <Icon
                name="ChevronDown"
                className="size-3.5 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className={SETTINGS_DROPDOWN_CONTENT_CLASS}
            mobileTitle="Microphone"
          >
            <DropdownMenuItem onSelect={() => onDeviceChange(null)}>
              {SYSTEM_DEFAULT_MICROPHONE_LABEL}
              <Icon
                name="Check"
                className={cn(
                  "ml-auto",
                  preferredDeviceId !== null && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
            {devices.length > 0 ? <DropdownMenuSeparator /> : null}
            {devices.map((device) => (
              <DropdownMenuItem
                key={device.deviceId}
                onSelect={() => onDeviceChange(device.deviceId)}
              >
                <span className="min-w-0 truncate">{device.label}</span>
                <Icon
                  name="Check"
                  className={cn(
                    "ml-auto",
                    preferredDeviceId !== device.deviceId && "opacity-0",
                    COARSE_POINTER_ICON_SIZE_CLASS,
                  )}
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsWithControl>
      {showTranscription ? (
        <>
          <TranscriptionProviderControl
            transcription={transcription}
            options={transcriptionProviderOptions(transcription)}
            onUpdate={onUpdateTranscription}
            disabled={isSavingTranscription}
          />
          {isLocalProvider ? localModelsSlot : null}
          <AdvancedTranscriptionControls
            transcription={transcription}
            onUpdate={onUpdateTranscription}
            isSaving={isSavingTranscription}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

function useVoiceTranscriptionStatus(): VoiceTranscriptionStatus | undefined {
  const { data } = useSystemConfig();
  if (data === undefined) {
    return undefined;
  }
  const ai = data.aiServices;
  return {
    model: ai.transcription,
    enabled: data.voiceTranscriptionEnabled,
    ceilingBytes: ai.transcriptionMaxBytes,
    timeoutMaxMs: ai.transcriptionTimeoutMaxMs,
    recordingBitrate: ai.recordingBitrate,
    voiceServices: ai.services
      .filter((service) => service.kinds.includes("voice"))
      .map((service) => ({
        id: service.id,
        displayName: service.displayName,
        pluginId: service.pluginId,
      })),
  };
}

function resolveLocalPluginId(
  transcription: VoiceTranscriptionStatus | undefined,
): string | null {
  if (transcription === undefined) {
    return null;
  }
  const service = transcription.voiceServices.find(
    (candidate) => candidate.id === LOCAL_TRANSCRIPTION_PROVIDER_ID,
  );
  return service?.pluginId ?? null;
}

export function VoiceInputSettingsSection() {
  const [preferredDeviceId, setPreferredDeviceId] =
    useAudioInputDevicePreference();
  const transcription = useVoiceTranscriptionStatus();
  const updateTranscription = useUpdateTranscriptionSettings();
  const { devices, errorMessage, isLoading, isSupported, refresh } =
    useAudioInputDevices();

  return (
    <VoiceInputSettingsSectionContent
      devices={devices}
      errorMessage={errorMessage}
      isLoading={isLoading}
      isSupported={isSupported}
      onDeviceChange={setPreferredDeviceId}
      onRefresh={(requestPermission) => {
        void refresh({ requestPermission });
      }}
      preferredDeviceId={preferredDeviceId}
      isSavingTranscription={updateTranscription.isPending}
      onUpdateTranscription={(update) => updateTranscription.mutate(update)}
      localModelsSlot={
        <LocalModelsSubsection
          pluginId={resolveLocalPluginId(transcription)}
          activeModelId={
            transcription !== undefined &&
            splitModel(transcription.model).provider === LOCAL_TRANSCRIPTION_PROVIDER_ID
              ? (splitModel(transcription.model).modelId || null)
              : null
          }
          onSelectModel={(id) => updateTranscription.mutate({ transcriptionModel: `local/${id}` })}
        />
      }
      {...(transcription === undefined ? {} : { transcription })}
    />
  );
}
