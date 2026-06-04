import { memo, useMemo, useRef, type ReactNode } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import {
  ExecutionControls,
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
  type MentionsConfig,
  type PromptBoxHandle,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import {
  BranchPicker,
  type BranchPickerMenuKind,
} from "@/components/pickers/BranchPicker";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerUIProps,
} from "@/components/pickers/EnvironmentPicker";
import {
  type ParsedEnvironmentValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import { HostPicker } from "@/components/pickers/HostPicker";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_CONTENT_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
} from "@/components/pickers/OptionPicker";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { cn } from "@/lib/utils";

const NEW_THREAD_PROMPT_BOX_MIN_HEIGHT = 80;

export type ThreadCreationMode = "thread" | "manager";

export interface NewThreadEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  hosts: readonly Host[];
  isLocalHost: EnvironmentPickerUIProps["isLocalHost"];
  /** When true, the picker's "Reuse existing worktree" entry is disabled.
   * Caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
}

export interface NewThreadBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  optionsTruncated?: boolean;
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
  /**
   * When provided, the picker exposes a "Create new branch" item. Only set
   * for `host:local` (work locally / remotely). Managed-worktree mode uses
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
}

export interface NewThreadHostConfig {
  /** All known hosts — used by `HostPicker` to render the selected host's
   * label even when it falls outside the eligible set. */
  hosts: readonly Host[];
  /** Hosts eligible to host a manager for this project (connected + has a
   * local-path source). The picker renders this list as menu items. */
  eligibleHosts: readonly Host[];
  /** Currently-selected host id. Empty string when no eligible host has
   * been resolved yet (e.g. while the hosts query is in flight). */
  value: string;
  onChange: (hostId: string) => void;
  isLocalHost: (id: string | null | undefined) => boolean;
}

/**
 * Mode-dependent block. Discriminated union — when mode is "thread" the
 * environment / branch / worktree / permission config is required and the
 * reuse-pill header slot is available; when mode is "manager" only the host
 * picker is meaningful. Invalid combinations (e.g. "manager" + reuse env)
 * are unrepresentable at the prop boundary.
 */
export type NewThreadModeConfig =
  | {
      mode: "thread";
      environment: NewThreadEnvironmentConfig;
      branch: NewThreadBranchConfig;
      worktree: NewThreadWorktreeConfig;
      permission: ExecutionPermissionConfig;
      /** Slot rendered inside the prompt box card, above the text area.
       * Used by RootComposeView to surface the reuse-worktree pill. */
      header?: ReactNode;
      /** Projectless threads choose only a host. When set, this replaces the
       * project environment / branch / worktree pickers below the prompt. */
      projectlessHost?: NewThreadHostConfig;
    }
  | {
      mode: "manager";
      /** Host picker shown beside the project selector. Managers need a
       * host because the manager thread runs on it; thread mode picks one
       * via the env picker, which manager mode lacks. */
      host: NewThreadHostConfig;
    };

export interface NewThreadPromptBoxUIProps {
  /** id forwarded to the underlying PromptBoxInternal (used for autofocus targeting). */
  id?: string;

  // PromptBox passthrough
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  disabled: boolean;
  /** zenMode storage key used for the root-compose zen-mode atom. */
  zenModeStorageKey: string;

  history: HistoryConfig;
  mentions: MentionsConfig;
  attachments: AttachmentsConfig;

  /** Mode-dependent config — see `NewThreadModeConfig`. The mode picker
   * above the prompt-box reads `.mode` for its current value. */
  modeConfig: NewThreadModeConfig;
  /** Called when the user switches modes from the picker. */
  onModeChange: (next: ThreadCreationMode) => void;

  project?: NewThreadProjectConfig;
  execution: ExecutionControlsProps;
}

interface GetBranchPickerMenuKindArgs {
  parsedEnvironment: ParsedEnvironmentValue;
}

interface GetNewThreadPromptPlaceholderArgs {
  mode: ThreadCreationMode;
  isProjectless: boolean;
}

function getBranchPickerMenuKind({
  parsedEnvironment,
}: GetBranchPickerMenuKindArgs): BranchPickerMenuKind | undefined {
  if (parsedEnvironment?.type !== "host") {
    return undefined;
  }

  return parsedEnvironment.mode === "worktree" ? "base" : "checkout";
}

function getNewThreadPromptPlaceholder({
  mode,
  isProjectless,
}: GetNewThreadPromptPlaceholderArgs): string {
  if (mode === "manager") {
    return isProjectless
      ? "Optional — instructions for the manager: what to work on, or how you like things done."
      : "Optional — instructions for the manager: what to work on, or how you like things done. @ to mention threads, files, or folders";
  }

  return isProjectless
    ? "Ask anything."
    : "Ask anything. @ to mention files or folders";
}

/**
 * Prop-only variant. Stories render this directly with mock host data; the
 * connected NewThreadPromptBox below wires up the real hooks.
 */
export const NewThreadPromptBoxUI = memo(function NewThreadPromptBoxUI({
  id,
  value,
  onChange,
  onSubmit,
  isSubmitting,
  disabled,
  zenModeStorageKey,
  history,
  mentions,
  attachments,
  modeConfig,
  onModeChange,
  project,
  execution,
}: NewThreadPromptBoxUIProps) {
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const voice = usePromptVoice(promptBoxRef);
  const isProjectlessPrompt =
    project?.value === null ||
    (modeConfig.mode === "thread" && modeConfig.projectlessHost !== undefined);
  const placeholder = getNewThreadPromptPlaceholder({
    mode: modeConfig.mode,
    isProjectless: isProjectlessPrompt,
  });
  return (
    <div data-promptbox-shell="" className="w-full">
      {/* Mode selector above the prompt-box: a quiet dropdown trigger that
          shares the prompt-box option sizing used by the footer and project
          strip controls, keeping their leading icons on the same left edge. */}
      <div className="mb-2 flex items-center px-3.5">
        <ModeSelector value={modeConfig.mode} onChange={onModeChange} />
      </div>
      <PromptBoxInternal
        id={id}
        promptBoxRef={promptBoxRef}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        autoFocus
        history={history}
        mentions={mentions}
        mentionMenuPlacement="bottom"
        attachments={attachments}
        voice={voice}
        submission={{
          isSubmitting,
          disabled,
          title: isSubmitting ? "Submitting..." : "Submit (Enter)",
          // Manager mode allows empty submission — the server falls back
          // to a welcome-message template when no input is provided.
          allowEmptyInput: modeConfig.mode === "manager",
        }}
        zenMode={{
          layout: "root-compose",
          storageKey: zenModeStorageKey,
        }}
        minHeight={NEW_THREAD_PROMPT_BOX_MIN_HEIGHT}
        placeholder={placeholder}
        header={modeConfig.mode === "thread" ? modeConfig.header : undefined}
        footerStart={<ExecutionControls {...execution} />}
      />
      {/* Strip below the prompt-box card: optional project + env + branch (or
          worktree) on the left, permission picker pinned to the right.
          In manager mode, the env / branch / worktree / permission pickers
          don't exist on the modeConfig — the discriminated union enforces
          the invariant. `mt-1` reproduces the 4px gap main got from a
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
            />
          ) : null}
          {modeConfig.mode === "manager" ? (
            <HostSlot host={modeConfig.host} />
          ) : (
            <ThreadEnvSlot
              environment={modeConfig.environment}
              branch={modeConfig.branch}
              worktree={modeConfig.worktree}
              projectlessHost={modeConfig.projectlessHost}
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {modeConfig.mode === "thread" ? (
            <PermissionModePicker
              value={modeConfig.permission.value}
              options={modeConfig.permission.options}
              onChange={modeConfig.permission.onChange}
              supported={modeConfig.permission.supported}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});

interface HostSlotProps {
  host: NewThreadHostConfig;
}

function HostSlot({ host }: HostSlotProps) {
  if (host.eligibleHosts.length < 2) return null;
  return (
    <HostPicker
      muted
      hosts={[...host.hosts]}
      eligibleHosts={[...host.eligibleHosts]}
      selectedHostId={host.value}
      onChange={host.onChange}
      isLocalHost={host.isLocalHost}
    />
  );
}

interface ThreadEnvSlotProps {
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  worktree: NewThreadWorktreeConfig;
  projectlessHost: NewThreadHostConfig | undefined;
}

function ThreadEnvSlot({
  environment,
  branch,
  worktree,
  projectlessHost,
}: ThreadEnvSlotProps) {
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(environment.value),
    [environment.value],
  );
  const branchMenuKind = getBranchPickerMenuKind({ parsedEnvironment });
  if (projectlessHost) {
    return <HostSlot host={projectlessHost} />;
  }
  const showBranchPicker = parsedEnvironment?.type === "host";
  const showWorktreePicker = parsedEnvironment?.type === "reuse";
  return (
    <>
      <EnvironmentPickerUI
        value={environment.value}
        onChange={environment.onChange}
        sources={environment.sources}
        hosts={environment.hosts}
        isLocalHost={environment.isLocalHost}
        reuseDisabled={environment.reuseDisabled}
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
          optionsTruncated={branch.optionsTruncated}
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
        />
      ) : null}
    </>
  );
}

interface ModeSelectorProps {
  value: ThreadCreationMode;
  onChange: (mode: ThreadCreationMode) => void;
}

const MODE_OPTIONS: readonly {
  value: ThreadCreationMode;
  icon: "MessageSquarePlus" | "UserRoundPlus";
  label: string;
}[] = [
  { value: "thread", icon: "MessageSquarePlus", label: "New thread" },
  { value: "manager", icon: "UserRoundPlus", label: "New manager" },
];

function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const selected = MODE_OPTIONS.find((option) => option.value === value);
  const TriggerIcon = selected?.icon ?? "MessageSquarePlus";
  const triggerLabel = selected?.label ?? "New thread";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Thread creation mode"
          className={cn(
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            "text-sm font-medium text-foreground hover:text-foreground",
          )}
        >
          <span className={OPTION_CONTENT_CLASS_NAME}>
            <Icon
              name={TriggerIcon}
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <Icon
            name="ChevronDown"
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" className="w-44">
        {MODE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <Icon
              name={option.icon}
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            {option.label}
            <Icon
              name="Check"
              className={cn(
                "ml-auto size-4",
                option.value === value ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface NewThreadConnectedEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  /** When true, the "Reuse existing worktree" entry in the env picker is
   * disabled — caller signals the project has no worktree envs available. */
  reuseDisabled?: boolean;
}

export interface NewThreadConnectedBranchConfig {
  value: string | null;
  currentBranch?: string | null;
  isNew: boolean;
  options: readonly string[];
  remoteOptions?: readonly string[];
  optionsTruncated?: boolean;
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
  onCreate: () => void;
}

/**
 * Connected variant of `NewThreadModeConfig`. In "thread" mode the env /
 * branch use the connected configs (without `hosts` / `isLocalHost` /
 * `onCreate` — the wrapper supplies those). In "manager" mode the host
 * config matches the UI variant (the caller already has the hosts query
 * and project sources, so there's nothing for the wrapper to enrich).
 */
export type NewThreadConnectedModeConfig =
  | {
      mode: "thread";
      environment: NewThreadConnectedEnvironmentConfig;
      branch: NewThreadConnectedBranchConfig;
      worktree: NewThreadWorktreeConfig;
      permission: ExecutionPermissionConfig;
      header?: ReactNode;
      projectlessHost?: NewThreadHostConfig;
    }
  | {
      mode: "manager";
      host: NewThreadHostConfig;
    };

export interface NewThreadPromptBoxProps extends Omit<
  NewThreadPromptBoxUIProps,
  "modeConfig"
> {
  modeConfig: NewThreadConnectedModeConfig;
}

type ConnectedThreadModeConfig = Extract<
  NewThreadConnectedModeConfig,
  { mode: "thread" }
>;

type NewThreadPromptBoxRest = Omit<NewThreadPromptBoxProps, "modeConfig">;

/**
 * The composed prompt area for creating a new thread in a project — used by
 * RootComposeView. In "thread" mode it wires host queries through
 * `ConnectedThreadModeBranch`; in "manager" mode it passes the config
 * straight through with no extra wiring.
 */
export function NewThreadPromptBox({
  modeConfig,
  ...rest
}: NewThreadPromptBoxProps) {
  if (modeConfig.mode === "manager") {
    return (
      <NewThreadPromptBoxUI
        {...rest}
        modeConfig={{
          mode: "manager",
          host: modeConfig.host,
        }}
      />
    );
  }
  return <ConnectedThreadModeBranch {...rest} threadConfig={modeConfig} />;
}

interface ConnectedThreadModeBranchProps extends NewThreadPromptBoxRest {
  threadConfig: ConnectedThreadModeConfig;
}

function ConnectedThreadModeBranch({
  threadConfig,
  ...rest
}: ConnectedThreadModeBranchProps) {
  const { isLocalHost } = useHostDaemon();
  const { data: hosts = [] } = useEffectiveHosts();

  const parsedEnvironment = parseEnvironmentValue(
    threadConfig.environment.value,
  );
  const isHostMode = parsedEnvironment?.type === "host";
  // Create-new-branch is only meaningful for host:local (work locally /
  // remotely) — the server checks out a fresh branch in the primary checkout
  // before the thread starts. Worktree mode uses the picked branch as the
  // branch source instead, so we omit onCreate there.
  const allowCreate = isHostMode && parsedEnvironment.mode === "local";

  const uiEnvironment = useMemo(
    () => ({ ...threadConfig.environment, hosts, isLocalHost }),
    [threadConfig.environment, hosts, isLocalHost],
  );
  const uiBranch = useMemo<NewThreadBranchConfig>(() => {
    const branch = threadConfig.branch;
    return {
      value: branch.value,
      currentBranch: branch.currentBranch,
      isNew: allowCreate && branch.isNew,
      options: branch.options,
      remoteOptions: branch.remoteOptions,
      optionsTruncated: branch.optionsTruncated,
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
      ...(allowCreate ? { onCreate: branch.onCreate } : {}),
    };
  }, [allowCreate, threadConfig.branch]);

  return (
    <NewThreadPromptBoxUI
      {...rest}
      modeConfig={{
        mode: "thread",
        environment: uiEnvironment,
        branch: uiBranch,
        worktree: threadConfig.worktree,
        permission: threadConfig.permission,
        header: threadConfig.header,
        projectlessHost: threadConfig.projectlessHost,
      }}
    />
  );
}
