import {
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type { Host, ProjectSource, PromptTextMention } from "@bb/domain";
import type { ComposerView } from "@get-bb/plugin-sdk";
import type { ComposerTextEffectSource } from "@/lib/composer-text-effects";
import { ComposerBannersSlot } from "@/components/plugin/PluginComposerBanners";
import {
  type PluginComposerHost,
  usePluginComposerViewModel,
} from "@/components/plugin/plugin-composer-host";
import {
  ComposerExtensionHost,
  useComposerExtensionController,
} from "@/components/plugin/ComposerExtensionHost";
import {
  ExecutionControls,
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
  type PromptBoxAction,
  type PromptBoxHandle,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  BranchPicker,
  type BranchPickerMenuKind,
} from "@/components/pickers/BranchPicker";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerMachines,
  type EnvironmentPickerUIProps,
} from "@/components/pickers/EnvironmentPicker";
import { MachinePickerUI } from "@/components/pickers/MachinePicker";
import {
  encodeHostValue,
  type ParsedEnvironmentValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import { PermissionModePicker } from "@/components/pickers/PermissionModePicker";
import {
  ProjectSelector,
  type ProjectSelectorCreateProjectConfig,
  type ProjectSelectorOption,
} from "@/components/pickers/ProjectSelector";
import {
  WorktreePicker,
  type ReuseThreadOption,
} from "@/components/pickers/WorktreePicker";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForPromptMode,
} from "./effective-prompt-mode";

const NEW_THREAD_PROMPT_BOX_MIN_HEIGHT = 80;
const DEFAULT_NEW_THREAD_COMPOSER_SCOPE = {
  kind: "new-thread",
  projectId: null,
} as const;

export interface NewThreadEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  host: EnvironmentPickerUIProps["host"];
  isLocal: EnvironmentPickerUIProps["isLocal"];
  machines?: EnvironmentPickerMachines | null;
  /** Opens the guided machine-setup flow for a machine without a project
   * source (multi-machine menu only). */
  onRequestMachineSetup?: (host: Host) => void;
  /** When true, the picker's "Reuse existing worktree" entry is disabled.
   * Caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
  worktreeDisabledReason?: string | null;
  disabled?: boolean;
}

export interface NewThreadBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  hidden?: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  priorityOptions?: readonly string[];
  loading?: boolean;
  placeholder?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  currentOptionLabel?: string | null;
  currentOptionTitle?: string;
  optionDisabledReason?: string | null;
  optionDisabledTitle?: string;
  createDisabledReason?: string | null;
  createDisabledTitle?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
  onCreateBaseChange?: (value: string) => void;
  disabled?: boolean;
  /**
   * When provided, the picker exposes a "Create new branch" item. Only set
   * for `host:local` (work locally / on host). Managed-worktree mode uses
   * the picked branch as the branch source instead.
   */
  onCreate?: () => void;
}

export interface NewThreadWorktreeConfig {
  options: readonly ReuseThreadOption[];
  /** Currently-selected env id, or null when reuse mode is active but no
   * worktree has been chosen yet. */
  value: string | null;
  onChange: (environmentId: string) => void;
  disabled?: boolean;
}

export interface NewThreadProjectConfig {
  projects: readonly ProjectSelectorOption[];
  /** Currently-selected project id, or null when the user has no project
   * scope. The picker handles the null case when `allowNoProject` is on. */
  value: string | null;
  onChange: (projectId: string | null) => void;
  /** When true, the picker exposes a "Don't work in a project" entry and
   * emits `null` from onChange. Off by default to match current production
   * (project is required). */
  allowNoProject?: boolean;
  createProject?: ProjectSelectorCreateProjectConfig;
  disabled?: boolean;
  /** The project list is still loading; the picker shows a loading label. */
  isLoading?: boolean;
  /** Keep the chevron while `disabled`, for transient locks (submitting,
   * uploading) that must not change the trigger's width. */
  showChevronWhenDisabled?: boolean;
}

export interface NewThreadModeConfig {
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  worktree: NewThreadWorktreeConfig;
  permission: ExecutionPermissionConfig;
  /** Slot rendered above the prompt box card, matching the follow-up banner stack. */
  banner?: ReactNode;
  /** Slot rendered inside the prompt box card, above the text area.
   * Used by RootComposeView to surface contextual creation state. */
  header?: ReactNode;
}

export interface NewThreadPromptBoxUIProps {
  /** id forwarded to the underlying PromptBoxInternal (used for autofocus targeting). */
  id?: string;

  // PromptBox passthrough
  value: string;
  mentionRanges: readonly PromptTextMention[];
  onChange: (value: string, mentionRanges: PromptTextMention[]) => void;
  onSubmit: () => void;
  promptBoxRef?: Ref<PromptBoxHandle>;
  isSubmitting: boolean;
  disabled: boolean;
  /** Whether the editor should take passive focus when it mounts. */
  autoFocus?: boolean;
  /** Active root-composer binding for plugin composer hooks and customizations. */
  pluginComposerHost?: PluginComposerHost | null;
  textEffects?: readonly ComposerTextEffectSource[];
  /** zenMode storage key used for the root-compose zen-mode atom. */
  zenModeStorageKey: string;
  /** Overrides the default new-thread placeholder copy. */
  placeholder?: string;

  history: HistoryConfig;
  typeahead: TypeaheadConfig;
  attachments: AttachmentsConfig;
  promptActions?: readonly PromptBoxAction[];

  /** Thread environment, branch/worktree, permission, and optional header config. */
  modeConfig: NewThreadModeConfig;

  project?: NewThreadProjectConfig;
  execution: ExecutionControlsProps;
}

interface GetBranchPickerMenuKindArgs {
  parsedEnvironment: ParsedEnvironmentValue;
}

function getBranchPickerMenuKind({
  parsedEnvironment,
}: GetBranchPickerMenuKindArgs): BranchPickerMenuKind | undefined {
  if (parsedEnvironment?.type !== "host") {
    return undefined;
  }

  return parsedEnvironment.mode === "worktree" ? "base" : "checkout";
}

function getNewThreadPromptPlaceholder(isProjectless: boolean): string {
  return isProjectless
    ? "Ask anything."
    : "Ask anything. @ to mention files, folders, or sections";
}

/**
 * Prop-only variant. Stories render this directly with mock host data; the
 * connected NewThreadPromptBox below wires up the real hooks.
 */
export const NewThreadPromptBoxUI = memo(function NewThreadPromptBoxUI({
  id,
  value,
  mentionRanges,
  onChange,
  onSubmit,
  promptBoxRef: externalPromptBoxRef,
  isSubmitting,
  disabled,
  autoFocus,
  pluginComposerHost,
  textEffects,
  zenModeStorageKey,
  placeholder: placeholderOverride,
  history,
  typeahead,
  attachments,
  promptActions,
  modeConfig,
  project,
  execution,
}: NewThreadPromptBoxUIProps) {
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const focusDefault = useCallback(() => {
    promptBoxRef.current?.focusEnd();
    return promptBoxRef.current !== null;
  }, []);
  useImperativeHandle(
    externalPromptBoxRef,
    () => ({
      captureHeightForLayoutChange: () => {
        promptBoxRef.current?.captureHeightForLayoutChange();
      },
      focusEnd: () => {
        promptBoxRef.current?.focusEnd();
      },
      insertTextAtCursor: (text) => {
        promptBoxRef.current?.insertTextAtCursor(text);
      },
      getTextBeforeCursor: () => promptBoxRef.current?.getTextBeforeCursor(),
      playVoiceCompletionTransition: () =>
        promptBoxRef.current?.playVoiceCompletionTransition() ??
        Promise.resolve(),
    }),
    [],
  );
  const voice = usePromptVoice(promptBoxRef);
  const attachmentCount = attachments.items?.length ?? 0;
  const [composerLayout, setComposerLayout] =
    useState<ComposerView["layout"]>("expanded");
  const composerView = usePluginComposerViewModel({
    scope: pluginComposerHost?.scope ?? DEFAULT_NEW_THREAD_COMPOSER_SCOPE,
    layout: composerLayout,
    text: value,
    attachmentCount,
    isRunning: false,
    isSubmitting,
  });
  const controller = useComposerExtensionController({
    host: pluginComposerHost ?? null,
    view: composerView,
    isFocused: isFocusedPane,
    isPrimary: true,
    focusDefault,
  });

  return (
    <ComposerExtensionHost
      controller={controller}
      defaultRenderer={
        <DefaultNewThreadComposer
          id={id}
          value={value}
          mentionRanges={mentionRanges}
          onChange={onChange}
          onSubmit={onSubmit}
          promptBoxRef={promptBoxRef}
          isSubmitting={isSubmitting}
          disabled={disabled}
          autoFocus={autoFocus}
          textEffects={textEffects}
          zenModeStorageKey={zenModeStorageKey}
          placeholder={placeholderOverride}
          history={history}
          typeahead={typeahead}
          attachments={attachments}
          promptActions={promptActions}
          modeConfig={modeConfig}
          project={project}
          execution={execution}
          voice={voice}
          onComposerLayoutChange={setComposerLayout}
        />
      }
    />
  );
});

interface DefaultNewThreadComposerProps extends Omit<
  NewThreadPromptBoxUIProps,
  "promptBoxRef" | "pluginComposerHost"
> {
  promptBoxRef: RefObject<PromptBoxHandle | null>;
  voice: ReturnType<typeof usePromptVoice>;
  onComposerLayoutChange: (layout: ComposerView["layout"]) => void;
}

/** BB's presentation for a host-owned new-thread Composer controller. */
export const DefaultNewThreadComposer = memo(function DefaultNewThreadComposer({
  id,
  value,
  mentionRanges,
  onChange,
  onSubmit,
  promptBoxRef,
  isSubmitting,
  disabled,
  autoFocus,
  textEffects,
  zenModeStorageKey,
  placeholder: placeholderOverride,
  history,
  typeahead,
  attachments,
  promptActions,
  modeConfig,
  project,
  execution,
  voice,
  onComposerLayoutChange,
}: DefaultNewThreadComposerProps) {
  const isProjectlessPrompt = project?.value === null;
  const placeholder =
    placeholderOverride ?? getNewThreadPromptPlaceholder(isProjectlessPrompt);
  const promptModeInput = useMemo(
    () => ({
      providerId: execution.provider.selectedId,
      value,
      mentionRanges,
    }),
    [execution.provider.selectedId, mentionRanges, value],
  );
  const permissionDisplayOverride = useMemo(
    () => permissionDisplayForPromptMode(promptModeInput),
    [promptModeInput],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForPromptMode(promptModeInput);
  const submitTitle = isSubmitting
    ? "Submitting..."
    : execution.model.isLoading
      ? "Loading models..."
      : "Submit (Enter)";

  return (
    <div
      data-app-composer=""
      data-app-composer-role="primary"
      data-promptbox-shell=""
      className="w-full"
    >
      <div className="mb-2 grid gap-2 empty:hidden">
        <ComposerBannersSlot ownerPlacement="before">
          {modeConfig.banner}
        </ComposerBannersSlot>
      </div>
      <PromptBoxInternal
        id={id}
        promptBoxRef={promptBoxRef}
        value={value}
        mentionRanges={mentionRanges}
        onChange={onChange}
        onSubmit={onSubmit}
        textEffects={textEffects}
        onComposerLayoutChange={onComposerLayoutChange}
        history={history}
        typeahead={typeahead}
        mentionMenuPlacement="bottom"
        attachments={attachments}
        promptActions={promptActions}
        voice={voice}
        submission={{
          isSubmitting,
          disabled,
          title: submitTitle,
        }}
        autoFocus={autoFocus}
        zenMode={{
          layout: "root-compose",
          storageKey: zenModeStorageKey,
        }}
        minHeight={NEW_THREAD_PROMPT_BOX_MIN_HEIGHT}
        placeholder={placeholder}
        header={modeConfig.header}
        footerStart={<ExecutionControls {...execution} />}
      />
      {/* Strip below the prompt-box card: optional project + env + branch (or
          worktree) on the left, permission picker pinned to the right. `mt-1`
          reproduces the 4px gap main got from a
          `space-y-1` wrapper in RootComposeView (now gone since the
          standalone project row was removed). */}
      <div className="mt-1 flex items-center justify-between gap-2 px-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {project ? (
            <ProjectSelector
              projects={project.projects}
              value={project.value}
              onChange={project.onChange}
              allowNoProject={project.allowNoProject ?? false}
              createProject={project.createProject}
              disabled={project.disabled}
              isLoading={project.isLoading}
              showChevronWhenDisabled={project.showChevronWhenDisabled}
              className="shrink-0"
            />
          ) : null}
          {project?.value !== null ? (
            <ThreadEnvSlot
              environment={modeConfig.environment}
              branch={modeConfig.branch}
              worktree={modeConfig.worktree}
            />
          ) : (
            <ProjectlessMachineSlot environment={modeConfig.environment} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PermissionModePicker
            value={modeConfig.permission.value}
            options={modeConfig.permission.options}
            onChange={modeConfig.permission.onChange}
            supported={modeConfig.permission.supported}
            disabled={permissionPickerDisabledByPlanMode}
            showChevronWhenDisabled={permissionPickerDisabledByPlanMode}
            displayOverride={permissionDisplayOverride}
          />
        </div>
      </div>
    </div>
  );
});

interface ThreadEnvSlotProps {
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  worktree: NewThreadWorktreeConfig;
}

export function ThreadEnvSlot({
  environment,
  branch,
  worktree,
}: ThreadEnvSlotProps) {
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(environment.value),
    [environment.value],
  );
  const branchMenuKind = getBranchPickerMenuKind({ parsedEnvironment });
  const showBranchPicker =
    parsedEnvironment?.type === "host" && branch.hidden !== true;
  const showWorktreePicker = parsedEnvironment?.type === "reuse";
  return (
    <>
      <EnvironmentPickerUI
        value={environment.value}
        onChange={environment.onChange}
        sources={environment.sources}
        host={environment.host}
        isLocal={environment.isLocal}
        machines={environment.machines}
        onRequestMachineSetup={environment.onRequestMachineSetup}
        reuseDisabled={environment.reuseDisabled}
        worktreeDisabledReason={environment.worktreeDisabledReason}
        disabled={environment.disabled}
        className="shrink-0"
        muted
      />
      {showBranchPicker ? (
        <BranchPicker
          variant="option"
          muted
          value={branch.value}
          currentBranch={branch.currentBranch}
          isCreatingNew={branch.isNew}
          options={branch.options}
          remoteOptions={branch.remoteOptions}
          priorityOptions={branch.priorityOptions}
          loading={branch.loading}
          placeholder={branch.placeholder}
          triggerLabel={branch.triggerLabel}
          triggerTitle={branch.triggerTitle}
          menuKind={branchMenuKind}
          currentOptionLabel={branch.currentOptionLabel}
          currentOptionTitle={branch.currentOptionTitle}
          optionDisabledReason={branch.optionDisabledReason}
          optionDisabledTitle={branch.optionDisabledTitle}
          createDisabledReason={branch.createDisabledReason}
          createDisabledTitle={branch.createDisabledTitle}
          disabled={branch.disabled}
          onChange={branch.onChange}
          onClear={branch.onClear}
          onOpenChange={branch.onOpenChange}
          onSearchQueryChange={branch.onSearchQueryChange}
          onCreateBaseChange={branch.onCreateBaseChange}
          onCreate={branch.onCreate}
        />
      ) : null}
      {showWorktreePicker ? (
        <WorktreePicker
          muted
          options={worktree.options}
          value={worktree.value}
          onChange={worktree.onChange}
          disabled={worktree.disabled}
        />
      ) : null}
    </>
  );
}

interface ProjectlessMachineSlotProps {
  environment: NewThreadEnvironmentConfig;
}

/**
 * Environment-slot replacement for projectless composing (>1 host): a
 * machine chip that picks which machine's personal workspace the thread runs
 * in. With a single host the slot stays empty.
 */
export function ProjectlessMachineSlot({
  environment,
}: ProjectlessMachineSlotProps) {
  const machines = environment.machines ?? null;
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(environment.value),
    [environment.value],
  );
  const handleChange = environment.onChange;
  const handleMachineChange = useCallback(
    (hostId: string) => {
      // Projectless threads always run in the machine's personal workspace,
      // so a machine pick encodes as that host's local mode.
      handleChange(encodeHostValue(hostId, "local"));
    },
    [handleChange],
  );
  if (!machines || machines.hosts.length <= 1) {
    return null;
  }
  return (
    <MachinePickerUI
      hosts={machines.hosts}
      localDaemonHostId={machines.localDaemonHostId}
      primaryHostId={machines.primaryHostId}
      selectedHostId={
        parsedEnvironment?.type === "host" ? parsedEnvironment.hostId : null
      }
      onChange={handleMachineChange}
      disabled={environment.disabled}
      className="shrink-0"
      muted
    />
  );
}

export interface NewThreadConnectedEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  /** Opens the guided machine-setup flow for a machine without a project
   * source (multi-machine menu only). */
  onRequestMachineSetup?: (host: Host) => void;
  /** When true, the "Reuse existing worktree" entry in the env picker is
   * disabled — caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
  worktreeDisabledReason?: string | null;
  disabled?: boolean;
}

export interface NewThreadConnectedBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  hidden?: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  loading?: boolean;
  placeholder?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  currentOptionLabel?: string | null;
  currentOptionTitle?: string;
  optionDisabledReason?: string | null;
  optionDisabledTitle?: string;
  createDisabledReason?: string | null;
  createDisabledTitle?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSearchQueryChange?: (query: string) => void;
  onCreateBaseChange?: (value: string) => void;
  disabled?: boolean;
  onCreate: () => void;
}

export interface NewThreadConnectedModeConfig {
  environment: NewThreadConnectedEnvironmentConfig;
  branch: NewThreadConnectedBranchConfig;
  worktree: NewThreadWorktreeConfig;
  permission: ExecutionPermissionConfig;
  banner?: ReactNode;
  header?: ReactNode;
}

export interface NewThreadPromptBoxProps extends Omit<
  NewThreadPromptBoxUIProps,
  "modeConfig"
> {
  modeConfig: NewThreadConnectedModeConfig;
}

type ConnectedThreadModeConfig = NewThreadConnectedModeConfig;

type NewThreadPromptBoxRest = Omit<NewThreadPromptBoxProps, "modeConfig">;

/**
 * The composed prompt area for creating a new thread in a project — used by
 * RootComposeView. It wires host queries through `ConnectedThreadModeBranch`.
 */
export function NewThreadPromptBox({
  modeConfig,
  ...rest
}: NewThreadPromptBoxProps) {
  return <ConnectedThreadModeBranch {...rest} threadConfig={modeConfig} />;
}

interface ConnectedThreadModeBranchProps extends NewThreadPromptBoxRest {
  threadConfig: ConnectedThreadModeConfig;
}

function ConnectedThreadModeBranch({
  threadConfig,
  ...rest
}: ConnectedThreadModeBranchProps) {
  const { data: hosts } = useHosts();
  const systemConfigQuery = useSystemConfig();
  const primaryHostId = systemConfigQuery.data?.primaryHostId ?? null;
  const primaryHost = useMemo(
    () => selectPrimaryHost(hosts, primaryHostId),
    [hosts, primaryHostId],
  );
  const { isLocalDaemonHost, localDaemonHostId } = useHostDaemon();

  const parsedEnvironment = parseEnvironmentValue(
    threadConfig.environment.value,
  );
  const selectedHost =
    parsedEnvironment?.type === "host"
      ? (hosts?.find((host) => host.id === parsedEnvironment.hostId) ??
        primaryHost)
      : primaryHost;
  const isLocalHost = selectedHost ? isLocalDaemonHost(selectedHost.id) : false;
  const machines = useMemo<EnvironmentPickerMachines | null>(
    () => (hosts ? { hosts, localDaemonHostId, primaryHostId } : null),
    [hosts, localDaemonHostId, primaryHostId],
  );

  const isHostMode = parsedEnvironment?.type === "host";
  // Create-new-branch is only meaningful for host:local (work locally /
  // on host) — the server checks out a fresh branch in the primary checkout
  // before the thread starts. Worktree mode uses the picked branch as the
  // branch source instead, so we omit onCreate there.
  const allowCreate = isHostMode && parsedEnvironment.mode === "local";

  const uiEnvironment = useMemo(
    () => ({
      ...threadConfig.environment,
      host: selectedHost,
      isLocal: isLocalHost,
      machines,
    }),
    [threadConfig.environment, selectedHost, isLocalHost, machines],
  );
  const uiBranch = useMemo<NewThreadBranchConfig>(() => {
    const branch = threadConfig.branch;
    return {
      value: branch.value,
      currentBranch: branch.currentBranch,
      isNew: allowCreate && branch.isNew,
      hidden: branch.hidden,
      options: branch.options,
      remoteOptions: branch.remoteOptions,
      loading: branch.loading,
      placeholder: branch.placeholder,
      triggerLabel: branch.triggerLabel,
      triggerTitle: branch.triggerTitle,
      currentOptionLabel: branch.currentOptionLabel,
      currentOptionTitle: branch.currentOptionTitle,
      optionDisabledReason: branch.optionDisabledReason,
      optionDisabledTitle: branch.optionDisabledTitle,
      createDisabledReason: branch.createDisabledReason,
      createDisabledTitle: branch.createDisabledTitle,
      onChange: branch.onChange,
      onClear: branch.onClear,
      onOpenChange: branch.onOpenChange,
      onSearchQueryChange: branch.onSearchQueryChange,
      onCreateBaseChange: branch.onCreateBaseChange,
      disabled: branch.disabled,
      ...(allowCreate ? { onCreate: branch.onCreate } : {}),
    };
  }, [allowCreate, threadConfig.branch]);

  return (
    <NewThreadPromptBoxUI
      {...rest}
      modeConfig={{
        environment: uiEnvironment,
        branch: uiBranch,
        worktree: threadConfig.worktree,
        permission: threadConfig.permission,
        banner: threadConfig.banner,
        header: threadConfig.header,
      }}
    />
  );
}
