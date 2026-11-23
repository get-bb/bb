import { useCallback, useMemo, useState } from "react";
import type { JsonValue, ProjectEnvironmentDefault } from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import type { PluginEnvironmentProviderInputsChange } from "@get-bb/plugin-sdk";
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

  const inputsPending = (
    next: DraftEnvironment,
    provider: SystemEnvironmentProvider | undefined,
  ): boolean =>
    next.blockedReason !== null ||
    (provider !== undefined && provider.inputs !== null && next.inputs === null);

  const commit = (next: DraftEnvironment | null) => {
    setDraft(() => next);
    if (sameEnvironment(next, saved)) return;
    if (
      next !== null &&
      inputsPending(
        next,
        providers.find(
          (provider) => provider.id === next.environmentProviderId,
        ),
      )
    ) {
      return;
    }
    updateProject.mutate(
      {
        id: projectId,
        defaultEnvironment:
          next === null
            ? null
            : {
                environmentProviderId: next.environmentProviderId,
                inputs: next.inputs,
              },
      },
      {
        onSuccess: () => setRememberedComposerEnvironment(""),
        onError: () => setDraft(() => draftFromSaved(saved)),
      },
    );
  };

  const selectProvider = (value: string) => {
    if (value === BUILT_IN_VALUE) {
      commit(null);
      return;
    }
    const provider = providers.find((candidate) => candidate.id === value);
    if (provider === undefined) return;
    if (saved?.environmentProviderId === provider.id) {
      commit(draftFromSaved(saved));
      return;
    }
    commit({
      environmentProviderId: provider.id,
      inputs:
        provider.inputs === null
          ? null
          : inputsSlotFor(provider) === undefined
            ? {}
            : null,
      blockedReason: null,
    });
  };

  const changeInputs = (next: PluginEnvironmentProviderInputsChange) => {
    if (draft === null) return;
    if (next.status === "blocked") {
      if (draft.blockedReason !== next.reason) {
        setDraft(() => ({ ...draft, blockedReason: next.reason }));
      }
      return;
    }
    if (
      draft.blockedReason === null &&
      JSON.stringify(draft.inputs) === JSON.stringify(next.value)
    ) {
      return;
    }
    commit({ ...draft, inputs: next.value, blockedReason: null });
  };

  const savedProviderMissing =
    saved !== null &&
    registeredProviders !== undefined &&
    !providers.some((provider) => provider.id === saved.environmentProviderId);
  const rowDescription = savedProviderMissing
    ? `"${saved.environmentProviderId}" is not available, so new threads without a chosen environment fail. Enable its plugin or pick another default.`
    : draft === null
      ? BUILT_IN_DESCRIPTION
      : draft.blockedReason !== null
        ? draft.blockedReason
        : selectedProvider !== undefined &&
            inputsPending(draft, selectedProvider)
          ? `Choose ${selectedProvider.displayName} options to save it as the default.`
          : undefined;

  return (
    <SettingsSection title="Default environment" description={DESCRIPTION}>
      <SettingsRowList>
        <SettingsWithControl label="New threads" description={rowDescription}>
          <div className="flex flex-wrap items-center justify-end gap-1">
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
            {selectedProvider !== undefined && selectedSlot !== undefined ? (
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
            ) : null}
          </div>
        </SettingsWithControl>
      </SettingsRowList>
    </SettingsSection>
  );
}
