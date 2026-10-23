import { useMemo } from "react";
import type { Host } from "@bb/domain";
import type {
  ProjectResponse,
  ProviderEnvironmentArgs,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Pill } from "@bb/shared-ui/pill";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerMachines,
} from "@/components/pickers/EnvironmentPicker";
import { encodeProviderValue } from "@/components/pickers/environment-picker-value";
import { providerInputsControlRequired } from "@/components/pickers/environment-provider-inputs";
import { buildEnvironmentProvidersByHostId } from "@/components/pickers/environment-providers-by-host";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { useUpdateProject } from "@/hooks/mutations/project-mutations";
import {
  usePromptBoxDraftEnvironmentSelection,
  usePromptBoxDraftMachineSelection,
} from "@/hooks/thread-creation-options/persisted-selection-fields";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import {
  selectHosts,
  selectPrimaryHost,
  useHosts,
} from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { projectDefaultEnvironmentLabel } from "@/views/root-compose-environment-selection";

const NEEDS_THREAD_OPTIONS = "Asks for options on each thread";
const NEEDS_GIT_REMOTE = "Needs the project's Git remote";
const NO_INPUTS_CONTROL_PROVIDER_IDS: ReadonlySet<string> = new Set();

const AUTOMATIC_DESCRIPTION =
  "The composer starts in your last choice; threads started without one, like automation runs, get a new worktree.";
const NEW_MACHINE_DESCRIPTION =
  "New threads start here unless you choose another, and so do threads started without a choice, like automation runs. Each one gets a new machine.";
const SET_DESCRIPTION =
  "New threads start here unless you choose another. Threads started without a choice, like automation runs, start here too; a Project checkout gives each of them its own worktree.";

type ProjectDefaultEnvironmentProject = Pick<
  ProjectResponse,
  | "id"
  | "gitRemoteUrl"
  | "sources"
  | "defaultEnvironment"
  | "defaultEnvironmentProblem"
>;

function defaultIneligibility(
  provider: SystemEnvironmentProvider,
  hasGitRemote: boolean,
): string | null {
  if (
    providerInputsControlRequired(provider) ||
    provider.machineAcceptsEmptyInputs === false
  ) {
    return NEEDS_THREAD_OPTIONS;
  }
  if (
    provider.machineProviderId &&
    (provider.requires.projectCheckout || provider.requires.gitRemote) &&
    !hasGitRemote
  ) {
    return NEEDS_GIT_REMOTE;
  }
  return null;
}

function withDefaultEligibility(
  provider: SystemEnvironmentProvider,
  hasGitRemote: boolean,
): SystemEnvironmentProvider {
  const message = defaultIneligibility(provider, hasGitRemote);
  return message === null
    ? provider
    : { ...provider, availability: { status: "unavailable", message } };
}

function sentence(message: string): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}`;
}

export function ProjectDefaultEnvironmentSetting({
  project,
  onRequestMachineSetup,
}: {
  project: ProjectDefaultEnvironmentProject;
  onRequestMachineSetup: (host: Host) => void;
}) {
  const hostsQuery = useHosts();
  const primaryHostId = useSystemConfig().data?.primaryHostId ?? null;
  const { localDaemonHostId, isLocalDaemonHost } = useHostDaemon();
  const updateProject = useUpdateProject();
  const { setValue: setDraftEnvironment } =
    usePromptBoxDraftEnvironmentSelection(project.id);
  const { setValue: setDraftMachine } = usePromptBoxDraftMachineSelection(
    project.id,
  );
  const { providers: registeredProviders } = useSystemEnvironmentProviders();
  const { providers: projectProviders } = useSystemEnvironmentProviders({
    projectId: project.id,
  });
  const hosts = useMemo(
    () => selectHosts(hostsQuery.data, "persistent"),
    [hostsQuery.data],
  );
  const projectScopedProviders = useMemo(
    () =>
      registeredProviders?.filter((provider) => !provider.requires.projectless),
    [registeredProviders],
  );
  const hasGitRemote = project.gitRemoteUrl !== null;
  const providers = useMemo(
    () =>
      projectScopedProviders?.map((provider) =>
        withDefaultEligibility(provider, hasGitRemote),
      ),
    [hasGitRemote, projectScopedProviders],
  );
  const providersByHostId = useMemo(
    () =>
      new Map(
        [
          ...buildEnvironmentProvidersByHostId({
            hosts,
            environmentProviders: projectScopedProviders,
            projectEnvironmentProviders: projectProviders,
            projectGitRemoteUrl: project.gitRemoteUrl,
            projectSources: project.sources,
          }),
        ].map(([hostId, hostProviders]) => [
          hostId,
          hostProviders.map((provider) =>
            withDefaultEligibility(provider, hasGitRemote),
          ),
        ]),
      ),
    [
      hasGitRemote,
      hosts,
      project.gitRemoteUrl,
      project.sources,
      projectProviders,
      projectScopedProviders,
    ],
  );
  const machines = useMemo<EnvironmentPickerMachines | null>(
    () =>
      hostsQuery.data === undefined
        ? null
        : { hosts, localDaemonHostId, primaryHostId },
    [hosts, hostsQuery.data, localDaemonHostId, primaryHostId],
  );

  const defaultEnvironment = project.defaultEnvironment;
  const problem = project.defaultEnvironmentProblem;
  const defaultHostId =
    defaultEnvironment?.machine.type === "existing"
      ? defaultEnvironment.machine.hostId
      : null;
  const host =
    hosts.find((candidate) => candidate.id === defaultHostId) ??
    selectPrimaryHost(hosts, primaryHostId);
  const label = projectDefaultEnvironmentLabel({
    defaultEnvironment,
    providers,
    hosts: hostsQuery.data,
  });
  const description =
    problem !== null
      ? `${sentence(problem.message)}. Threads started without a choice fail until you change or reset it.`
      : defaultEnvironment === null
        ? AUTOMATIC_DESCRIPTION
        : defaultEnvironment.machine.type === "new"
          ? NEW_MACHINE_DESCRIPTION
          : SET_DESCRIPTION;

  const changeDefault = (
    defaultEnvironmentRequest: ProviderEnvironmentArgs | null,
  ) =>
    updateProject.mutate(
      { id: project.id, defaultEnvironment: defaultEnvironmentRequest },
      {
        onSuccess: () => {
          setDraftEnvironment("");
          setDraftMachine("");
        },
      },
    );

  const selectProvider = (
    provider: SystemEnvironmentProvider,
    hostId: string | null,
  ) => {
    if (
      problem === null &&
      defaultEnvironment?.environmentProviderId === provider.id &&
      defaultHostId === hostId
    ) {
      return;
    }
    changeDefault({
      type: "provider",
      environmentProviderId: provider.id,
      ...(hostId === null
        ? {}
        : { machine: { type: "existing" as const, hostId } }),
      inputs: null,
    });
  };

  return (
    <SettingsWithControl label="Environment" description={description}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {problem === null ? null : (
          <Pill variant="destructive">Unavailable</Pill>
        )}
        <EnvironmentPickerUI
          value={
            defaultEnvironment === null
              ? ""
              : encodeProviderValue(defaultEnvironment.environmentProviderId)
          }
          sources={project.sources}
          host={host}
          isLocal={host !== null && isLocalDaemonHost(host.id)}
          machines={machines}
          onRequestMachineSetup={onRequestMachineSetup}
          disabled={updateProject.isPending}
          isLoading={providers === undefined}
          providers={providers ?? []}
          providersByHostId={providersByHostId}
          selectedProviderHostId={defaultHostId}
          inputsControlProviderIds={NO_INPUTS_CONTROL_PROVIDER_IDS}
          onSelectProvider={selectProvider}
          displayOverride={
            problem !== null
              ? { label, icon: "AlertTriangle" }
              : defaultEnvironment === null
                ? { label, icon: "Laptop" }
                : { label }
          }
        />
        {defaultEnvironment === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={updateProject.isPending}
            onClick={() => changeDefault(null)}
          >
            Reset
          </Button>
        )}
      </div>
    </SettingsWithControl>
  );
}
