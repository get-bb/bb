import type { Host } from "@bb/domain";
import { ScrollView } from "react-native";
import type { ExecutionControlsProps } from "@/composer";
import {
  BranchPicker,
  EnvironmentPicker,
  HostPicker,
  PathPicker,
  ProjectPicker,
} from "../pickers";
import type { ComposeController } from "./useComposeController";

/**
 * The agent pills (project, provider, model + reasoning (+ Fast),
 * permissions) as the shared composer's execution-controls props. The
 * project picker rides in `leading` because it is a compose-screen concept.
 */
export function composeExecutionControls(
  controller: ComposeController,
  options: { onCreateProject?: () => void; disabled?: boolean } = {},
): ExecutionControlsProps {
  const c = controller;
  return {
    leading: (
      <ProjectPicker
        projects={c.projects}
        personalProject={c.personalProject}
        value={c.projectId}
        onChange={c.selectProject}
        onCreateProject={options.onCreateProject}
        disabled={options.disabled}
        loading={c.projectsLoading}
      />
    ),
    provider: {
      options: c.providerOptions,
      value: c.providerId,
      onChange: c.selectProvider,
      loading: c.isLoadingModels && c.providerOptions.length === 0,
    },
    model: {
      options: c.modelOptions,
      moreOptions: c.moreModelOptions,
      value: c.model,
      onChange: c.selectModel,
      isLoading: c.isLoadingModels,
      loadErrorMessage: c.modelLoadErrorMessage,
    },
    reasoning: {
      options: c.reasoningOptions,
      value: c.reasoningLevel,
      onChange: c.selectReasoningLevel,
    },
    fastMode: c.supportsServiceTier
      ? { enabled: c.fastMode, onChange: c.setFastMode }
      : null,
    permission: {
      options: c.permissionModeOptions,
      value: c.permissionMode,
      onChange: c.selectPermissionMode,
    },
    disabled: options.disabled,
    testID: "compose-controls",
  };
}

export interface EnvironmentControlsRowProps {
  controller: ComposeController;
  /** Opens the guided setup for a connected machine without a project source. */
  onRequestMachineSetup?: (host: Host) => void;
  disabled?: boolean;
}

/**
 * The environment pill row under the composer, scrolling horizontally: where
 * it runs, then the machine / branch / folder pickers the selected mode needs.
 */
export function EnvironmentControlsRow({
  controller,
  onRequestMachineSetup,
  disabled = false,
}: EnvironmentControlsRowProps) {
  const c = controller;
  const showHostPicker = c.hosts.length > 1 && c.environment.type !== "reuse";
  const hostName = c.selectedHost?.name ?? null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      testID="compose-environment-controls"
    >
      <EnvironmentPicker
        value={c.environment}
        onChange={c.setEnvironment}
        host={c.selectedHost}
        hostHasSource={c.hostHasSource}
        primaryHostId={c.primaryHostId}
        isPersonalProject={c.isPersonalProject}
        reuseOptions={c.reuseOptions}
        reuseOptionsLoading={c.reuseOptionsLoading}
        worktreeDisabledReason={c.worktreeDisabledReason}
        disabled={disabled}
      />
      {showHostPicker ? (
        <HostPicker
          hosts={c.hosts}
          value={c.environment.type === "host" ? c.environment.hostId : null}
          onChange={c.selectHost}
          hostIdsWithSource={c.hostIdsWithSource}
          primaryHostId={c.primaryHostId}
          onRequestSetup={onRequestMachineSetup}
          disabled={disabled}
        />
      ) : null}
      {c.branch ? (
        <BranchPicker
          mode={c.branch.mode}
          branches={c.branch.branches}
          remoteBranches={c.branch.remoteBranches}
          selected={c.branch.selected}
          defaultBranch={c.branch.defaultBranch}
          searchQuery={c.branch.searchQuery}
          onSearchQueryChange={c.branch.setSearchQuery}
          isLoading={c.branch.isLoading}
          onSelect={c.branch.select}
          onClear={c.branch.clear}
          onCreateFrom={
            c.branch.mode === "local" ? c.branch.createFrom : undefined
          }
          disabled={disabled}
        />
      ) : null}
      {c.hostMode === "local" ? (
        <PathPicker
          hostId={c.selectedHost?.id ?? null}
          hostName={hostName}
          defaultPath={c.defaultWorkspacePath}
          value={c.workspacePath}
          onChange={c.setWorkspacePath}
          disabled={disabled}
        />
      ) : null}
    </ScrollView>
  );
}
