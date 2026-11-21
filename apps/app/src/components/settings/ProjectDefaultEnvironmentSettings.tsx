import { useCallback, useMemo, useState } from "react";
import type { JsonValue, ProjectEnvironmentDefault } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import type { PluginEnvironmentProviderInputsChange } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";
import { providerInputsControlRequired } from "@/components/pickers/environment-provider-inputs";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { useUpdateProject } from "@/hooks/mutations/project-mutations";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { usePromptBoxEnvironmentPreference } from "@/hooks/thread-creation-options/persisted-selection-fields";
import { usePluginSlotKind } from "@/lib/plugin-slots";

const BUILT_IN_VALUE = "";

const DESCRIPTION =
  "Where new threads in this project run unless you pick another environment. Children of a running thread follow their parent instead.";

const BUILT_IN_DESCRIPTION =
  "The composer keeps your last pick; the CLI and automations use a worktree for Git projects";

interface DraftEnvironment {
  environmentProviderId: string;
  inputs: JsonValue | null;
  blockedReason: string | null;
}

interface DraftState {
  savedSignature: string;
  draft: DraftEnvironment | null;
}

function draftFromSaved(
  saved: ProjectEnvironmentDefault | null,
): DraftEnvironment | null {
  return saved === null ? null : { ...saved, blockedReason: null };
}

function sameEnvironment(
  draft: DraftEnvironment | null,
  saved: ProjectEnvironmentDefault | null,
): boolean {
  if (draft === null || saved === null) return draft === saved;
  return (
    draft.environmentProviderId === saved.environmentProviderId &&
    JSON.stringify(draft.inputs) === JSON.stringify(saved.inputs)
  );
}

export function projectDefaultEnvironmentProviders(
  providers: readonly SystemEnvironmentProvider[],
): readonly SystemEnvironmentProvider[] {
  return providers.filter(
    (provider) => !provider.requires.projectless && !provider.machineProviderId,
  );
}

export function ProjectDefaultEnvironmentSettings({
  projectId,
  saved,
  inputsHostId,
}: {
  projectId: string;
  saved: ProjectEnvironmentDefault | null;
  inputsHostId: string | null;
}) {
  const updateProject = useUpdateProject();
  const { setValue: setRememberedComposerEnvironment } =
    usePromptBoxEnvironmentPreference(projectId);
  const { providers: registeredProviders } = useSystemEnvironmentProviders({
    projectId,
  });
  const providers = useMemo(
    () => projectDefaultEnvironmentProviders(registeredProviders ?? []),
    [registeredProviders],
  );
  const inputsSlots = usePluginSlotKind("environmentProviderInputs");

  const savedSignature = JSON.stringify(saved);
  const [state, setState] = useState<DraftState>(() => ({
    savedSignature,
    draft: draftFromSaved(saved),
  }));
  let draft = state.draft;
  if (state.savedSignature !== savedSignature) {
    draft = draftFromSaved(saved);
    setState({ savedSignature, draft });
  }
  const setDraft = useCallback(
    (update: (current: DraftEnvironment | null) => DraftEnvironment | null) =>
      setState((current) => ({ ...current, draft: update(current.draft) })),
    [],
  );

  const inputsSlotFor = useCallback(
    (provider: SystemEnvironmentProvider) =>
      inputsSlots.find(
        (slot) =>
          slot.environmentProviderId === provider.id &&
          slot.pluginId === provider.pluginId,
      ),
    [inputsSlots],
  );

  const options = useMemo((): PickerOption<string>[] => {
    const providerOptions = providers.map((provider) => {
      const disabledReason =
        provider.availability?.status === "unavailable"
          ? provider.availability.message
          : inputsSlotFor(provider) === undefined &&
              providerInputsControlRequired(provider)
            ? "Needs its plugin's control"
            : undefined;
      return {
        value: provider.id,
        label: provider.displayName,
        ...(provider.description === null
          ? {}
          : { description: provider.description }),
        ...(disabledReason === undefined
          ? {}
          : { disabled: true, disabledReason }),
      };
    });
    return [
      {
        value: BUILT_IN_VALUE,
        label: "Not set",
        description: BUILT_IN_DESCRIPTION,
      },
      ...providerOptions,
    ];
  }, [inputsSlotFor, providers]);

  const selectedProvider =
    draft === null
      ? undefined
      : providers.find(
          (provider) => provider.id === draft.environmentProviderId,
        );
  const selectedSlot =
    selectedProvider === undefined || selectedProvider.inputs === null
      ? undefined
      : inputsSlotFor(selectedProvider);

  const selectProvider = useCallback(
    (value: string) => {
      if (value === BUILT_IN_VALUE) {
        setDraft(() => null);
        return;
      }
      const provider = providers.find((candidate) => candidate.id === value);
      if (provider === undefined) return;
      setDraft(() => {
        if (saved?.environmentProviderId === provider.id) {
          return draftFromSaved(saved);
        }
        const inputs =
          provider.inputs === null
            ? null
            : inputsSlotFor(provider) === undefined
              ? {}
              : null;
        return {
          environmentProviderId: provider.id,
          inputs,
          blockedReason: null,
        };
      });
    },
    [inputsSlotFor, providers, saved, setDraft],
  );

  const changeInputs = useCallback(
    (next: PluginEnvironmentProviderInputsChange) => {
      setDraft((current) => {
        if (current === null) return current;
        if (next.status === "blocked") {
          return current.blockedReason === next.reason
            ? current
            : { ...current, blockedReason: next.reason };
        }
        if (
          current.blockedReason === null &&
          JSON.stringify(current.inputs) === JSON.stringify(next.value)
        ) {
          return current;
        }
        return { ...current, inputs: next.value, blockedReason: null };
      });
    },
    [setDraft],
  );

  const dirty = !sameEnvironment(draft, saved);
  const saveBlockedReason =
    draft === null
      ? null
      : draft.blockedReason !== null
        ? draft.blockedReason
        : selectedProvider !== undefined &&
            selectedProvider.inputs !== null &&
            draft.inputs === null
          ? `Configure ${selectedProvider.displayName}`
          : null;
  const save = () => {
    const defaultEnvironment: ProjectEnvironmentDefault | null =
      draft === null
        ? null
        : {
            environmentProviderId: draft.environmentProviderId,
            inputs: draft.inputs,
          };
    updateProject.mutate(
      { id: projectId, defaultEnvironment },
      { onSuccess: () => setRememberedComposerEnvironment("") },
    );
  };

  const savedProviderMissing =
    saved !== null &&
    registeredProviders !== undefined &&
    !providers.some((provider) => provider.id === saved.environmentProviderId);

  return (
    <SettingsSection title="Default environment" description={DESCRIPTION}>
      <SettingsRowList>
        <SettingsWithControl
          label="New threads"
          description={
            savedProviderMissing
              ? `"${saved.environmentProviderId}" is not available, so new threads without a chosen environment fail. Enable its plugin or pick another default.`
              : undefined
          }
        >
          <OptionPicker
            label="Default environment"
            value={draft?.environmentProviderId ?? BUILT_IN_VALUE}
            options={options}
            onChange={selectProvider}
            disabled={registeredProviders === undefined}
            align="end"
            {...(draft !== null && selectedProvider === undefined
              ? { displayOverride: { label: draft.environmentProviderId } }
              : {})}
          />
        </SettingsWithControl>
        {selectedProvider !== undefined && selectedSlot !== undefined ? (
          <div className="flex justify-end">
            <PluginSlotMount
              pluginId={selectedSlot.pluginId}
              slotKind="environmentProviderInputs"
              slotId={selectedSlot.environmentProviderId}
            >
              <selectedSlot.component
                projectId={projectId}
                target={
                  inputsHostId === null
                    ? { kind: "new-host" }
                    : { kind: "existing-host", hostId: inputsHostId }
                }
                value={draft?.inputs ?? null}
                onChange={changeInputs}
              />
            </PluginSlotMount>
          </div>
        ) : null}
        {dirty ? (
          <div className="flex items-center justify-end gap-2">
            {saveBlockedReason !== null ? (
              <p className="mr-auto text-xs text-muted-foreground">
                {saveBlockedReason}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(() => draftFromSaved(saved))}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saveBlockedReason !== null}
              onClick={save}
            >
              Save
            </Button>
          </div>
        ) : null}
      </SettingsRowList>
    </SettingsSection>
  );
}
