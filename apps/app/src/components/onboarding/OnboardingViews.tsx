import { ExpandableText } from "@bb/shared-ui/expandable-text";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { useState, type ReactNode } from "react";
import type { ExperimentalProviderIconProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { ResourceBrowseGrid } from "@bb/shared-ui/resource-list";
import {
  DisclosureToggle,
  InlinePanel,
  InlineTextLink,
  SignInPanel,
  type SignInPanelVariant,
} from "@bb/shared-ui/sign-in-panel";
import {
  SETUP_GUIDE_CONTAINER_CLASS,
  SetupOptionGroup,
  SetupOptionRow,
} from "@bb/shared-ui/setup-option-row";
import { Switch } from "@bb/shared-ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PluginAuthorByline,
  PluginCard,
} from "@/components/plugin/management/PluginCard";
import { CatalogEntryIconChip } from "@/components/plugin/management/plugin-ui";
import { terminalOutputToPlainText } from "@bb/text-utils";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
} from "@/lib/bb-desktop";
import {
  ONBOARDING_STEPS,
  signInSiteName,
  type AgentSetupState,
  type AgentSignInView,
  type OnboardingStepId,
} from "./onboarding-model";
import bbLogoUrl from "../../../../../assets/bb-logo.svg";

const ONBOARDING_LIST_CLASS =
  "divide-y divide-border-hairline rounded-lg border border-border";

const CONTENT_COLUMN_CLASS =
  "mx-auto w-full max-w-150 px-4 @xl/onboarding:px-6";

interface OnboardingLayoutProps {
  step: OnboardingStepId;
  width?: "default" | "wide";
  skippedSteps?: ReadonlySet<OnboardingStepId>;
  compact?: boolean;
  reserveMacosTrafficLights?: boolean;
  title: string;
  description: ReactNode;
  children: ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  onPrimary: () => void;
  onBack?: () => void;
  onSelectStep: (step: OnboardingStepId) => void;
}

export function OnboardingLayout({
  step,
  width = "default",
  skippedSteps,
  compact = false,
  reserveMacosTrafficLights = false,
  title,
  description,
  children,
  primaryLabel,
  primaryDisabled = false,
  primaryBusy = false,
  onPrimary,
  onBack,
  onSelectStep,
}: OnboardingLayoutProps) {
  const activeIndex = ONBOARDING_STEPS.findIndex((entry) => entry.id === step);
  return (
    <div
      data-testid="onboarding"
      className={cn(
        SETUP_GUIDE_CONTAINER_CLASS,
        "flex min-h-0 flex-1 flex-col bg-background text-foreground",
      )}
    >
      <header
        className={cn(
          "grid h-14 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 pr-4 @xl/onboarding:gap-3",
          reserveMacosTrafficLights
            ? cn(
                MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
                MACOS_WINDOW_DRAG_CLASS,
              )
            : "pl-4",
        )}
      >
        <img
          src={bbLogoUrl}
          alt="bb"
          draggable={false}
          className="h-5 w-6 shrink-0 select-none object-contain dark:invert"
        />
        <nav
          aria-label="Setup steps"
          className="col-start-2 row-start-1 flex min-w-0 items-center justify-center gap-1"
        >
          {ONBOARDING_STEPS.map((entry, index) => {
            const passed = index < activeIndex;
            const skipped = passed && (skippedSteps?.has(entry.id) ?? false);
            const done = passed && !skipped;
            const active = index === activeIndex;
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!passed}
                aria-current={active ? "step" : undefined}
                aria-label={skipped ? `${entry.label} (skipped)` : entry.label}
                onClick={() => onSelectStep(entry.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-1 py-1 text-xs font-medium transition-colors @xl/onboarding:px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  MACOS_APP_REGION_NO_DRAG_CLASS,
                  active && "text-foreground",
                  passed && "text-subtle-foreground hover:bg-state-hover",
                  !active && !passed && "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                    active && "bg-foreground text-background",
                    done && "bg-success text-background",
                    skipped && "bg-state-hover text-subtle-foreground",
                    !active && !passed && "border border-border",
                  )}
                >
                  {done ? (
                    <Icon name="Check" aria-hidden className="size-3" />
                  ) : skipped ? (
                    <Icon name="Minus" aria-hidden className="size-3" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    !active && "sr-only @xl/onboarding:not-sr-only",
                  )}
                >
                  {entry.label}
                </span>
              </button>
            );
          })}
        </nav>
        <span aria-hidden className="col-start-3 row-start-1 w-6" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          className={cn(
            CONTENT_COLUMN_CLASS,
            width === "wide" && "max-w-3xl",
            "flex flex-col gap-5 pt-8",
            compact ? "pb-4" : "pb-6",
          )}
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-balance text-sm text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
          <div className="sticky bottom-0 flex flex-col items-center gap-2 bg-background pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-gradient-to-t before:from-background before:to-transparent">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onBack ? (
                <Button variant="ghost" size="sm" onClick={onBack}>
                  <Icon name="ArrowLeft" aria-hidden />
                  Back
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={primaryDisabled || primaryBusy}
                onClick={onPrimary}
              >
                {primaryBusy ? (
                  <Icon name="Spinner" aria-hidden className="animate-spin" />
                ) : null}
                {primaryLabel}
                {primaryBusy ? null : <Icon name="ArrowRight" aria-hidden />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface AgentLoadingRow {
  loadingKey: string;
}

export interface OnboardingAgent {
  id: string;
  name: string;
  provider: ExperimentalProviderIconProps["provider"];
  state: AgentSetupState;
  setup?: "signIn" | "connect";
  installQueued?: boolean;
  installLog?: string;
  subline?: ReactNode;
  expanded?: ReactNode;
}

const AGENT_STATUS_COPY = {
  startingSignIn: "Starting sign in…",
  signInFailed: "Sign-in didn't finish · try again",
  updateNeeded: "Update needed",
  unknown: "Couldn't check this agent",
} as const;

function installActionLabel(
  state: Extract<
    AgentSetupState,
    { status: "install" | "update" | "installFailed" | "installing" }
  >,
): string {
  return state.status === "installFailed"
    ? "Retry"
    : state.status === "update"
      ? "Update"
      : "Install";
}

function terminalToggleLabel(terminalVisible: boolean): string {
  return terminalVisible ? "Hide terminal" : "Show terminal";
}

function agentSubline(
  state: AgentSetupState,
  setup: "signIn" | "connect",
): string | null {
  switch (state.status) {
    case "ready":
      return state.detail;
    case "signIn":
      if (state.reason !== "failed") return null;
      return setup === "connect"
        ? "Connecting didn't finish · try again"
        : AGENT_STATUS_COPY.signInFailed;
    case "update":
      return state.detail ?? AGENT_STATUS_COPY.updateNeeded;
    case "installFailed":
      return state.message;
    case "unknown":
      return state.message ?? AGENT_STATUS_COPY.unknown;
    case "checkFailed":
      return state.message;
    case "signingIn":
      return setup === "connect"
        ? "Choose a provider and sign in below."
        : AGENT_STATUS_COPY.startingSignIn;
    case "install":
    case "installing":
      return null;
  }
}

function RowDismissButton({
  label,
  tooltip,
  onClick,
}: {
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground"
          aria-label={label}
          onClick={onClick}
        >
          <Icon name="X" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function AgentActionButton({
  agent,
  label,
  busyLabel,
  busy,
  onClick,
}: {
  agent: OnboardingAgent;
  label: string;
  busyLabel: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={onClick}>
      {busy ? (
        <Icon name="Spinner" aria-hidden className="size-4 animate-spin" />
      ) : (
        <ProviderIcon
          providerKind="agent"
          provider={agent.provider}
          className="size-4"
        />
      )}
      {busy ? busyLabel : label}
    </Button>
  );
}

interface AgentRowHandlers {
  onSignIn: (id: string) => void;
  onInstall: (id: string) => void;
  onCancelSignIn: (id: string) => void;
  onRetryCheck: (id: string) => void;
}

function RetryButton({
  retrying,
  onClick,
}: {
  retrying: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="outline" disabled={retrying} onClick={onClick}>
      {retrying ? (
        <Icon name="Spinner" aria-hidden className="size-4 animate-spin" />
      ) : null}
      Retry
    </Button>
  );
}

function AgentRow({
  agent,
  onSignIn,
  onInstall,
  onCancelSignIn,
  onRetryCheck,
}: AgentRowHandlers & { agent: OnboardingAgent }) {
  const { state } = agent;
  const setup = agent.setup ?? "signIn";
  const hasSubline = agent.subline !== undefined && agent.subline !== null;
  const statusSubline = hasSubline ? null : agentSubline(state, setup);
  const hasSubtitle = hasSubline || statusSubline !== null;
  const inProgress = state.status === "signingIn" && hasSubtitle;
  return (
    <li className="px-3 py-3" data-agent-id={agent.id}>
      <div className="flex items-center gap-3">
        <ProviderIcon
          providerKind="agent"
          provider={agent.provider}
          className={cn(
            "size-6",
            state.status === "install" && "text-muted-foreground",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{agent.name}</span>
          {hasSubtitle ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {inProgress ? (
                <Icon
                  name="Spinner"
                  aria-hidden
                  className="size-3.5 shrink-0 animate-spin text-subtle-foreground"
                />
              ) : null}
              {hasSubline ? (
                <span className="min-w-0 text-xs text-muted-foreground">
                  {agent.subline}
                </span>
              ) : (
                <ExpandableText
                  expandLabel="Show details"
                  className={cn(
                    "min-w-0 text-xs text-muted-foreground",
                    state.status === "ready" && "text-subtle-foreground",
                  )}
                >
                  {statusSubline}
                </ExpandableText>
              )}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          {state.status === "ready" ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="CircleCheck" aria-hidden className="size-3.5" />
              Ready
            </span>
          ) : null}
          {state.status === "signIn" && state.canSignIn ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSignIn(agent.id)}
            >
              <ProviderIcon
                providerKind="agent"
                provider={agent.provider}
                className="size-4"
              />
              Sign in
            </Button>
          ) : null}
          {state.status === "installing" ||
          ((state.status === "install" ||
            state.status === "update" ||
            state.status === "installFailed") &&
            state.canInstall) ? (
            <AgentActionButton
              agent={agent}
              label={installActionLabel(state)}
              busyLabel={
                agent.installQueued === true
                  ? "Waiting…"
                  : state.status === "installing" && state.update
                    ? "Updating…"
                    : "Installing…"
              }
              busy={state.status === "installing"}
              onClick={() => onInstall(agent.id)}
            />
          ) : null}
          {state.status === "checkFailed" ? (
            <RetryButton
              retrying={state.retrying}
              onClick={() => onRetryCheck(agent.id)}
            />
          ) : null}
          {state.status === "signingIn" ? (
            <RowDismissButton
              label={`Cancel signing in to ${agent.name}`}
              tooltip="Cancel"
              onClick={() => onCancelSignIn(agent.id)}
            />
          ) : null}
        </div>
      </div>
      {agent.expanded}
      {state.status === "installFailed" && agent.installLog !== undefined ? (
        <AgentInstallErrorDetails log={agent.installLog} />
      ) : null}
      {state.status === "checkFailed" && state.detail !== null ? (
        <AgentInstallErrorDetails log={state.detail} />
      ) : null}
    </li>
  );
}

function AgentRowSkeleton() {
  return (
    <li
      data-testid="agent-row-skeleton"
      className="flex items-center gap-3 px-3 py-3"
    >
      <span className="size-6 rounded-md bg-state-hover" />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="h-3 w-28 rounded-sm bg-state-hover" />
        <span className="h-2.5 w-40 rounded-sm bg-state-hover" />
      </span>
    </li>
  );
}

interface AgentStepProps extends AgentRowHandlers {
  machineName: string | null;
  agents: readonly (OnboardingAgent | AgentLoadingRow)[] | null;
  loadFailed: { message: string; retrying: boolean } | null;
  onRecheck: () => void;
}

export function AgentStep({
  machineName,
  agents,
  loadFailed,
  onRecheck,
  ...rowHandlers
}: AgentStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="Laptop" aria-hidden className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">
          {machineName === null
            ? "Waiting for this computer to connect…"
            : `On ${machineName}`}
        </span>
      </div>
      {loadFailed !== null ? (
        <ul className={ONBOARDING_LIST_CLASS}>
          <li className="flex items-center gap-3 px-3 py-3">
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {loadFailed.message}
            </span>
            <RetryButton retrying={loadFailed.retrying} onClick={onRecheck} />
          </li>
        </ul>
      ) : agents === null ? (
        <ul className={ONBOARDING_LIST_CLASS}>
          {[0, 1, 2].map((index) => (
            <AgentRowSkeleton key={index} />
          ))}
        </ul>
      ) : (
        <ul className={cn(ONBOARDING_LIST_CLASS, "overflow-hidden")}>
          {agents.map((agent) =>
            "loadingKey" in agent ? (
              <AgentRowSkeleton key={`loading:${agent.loadingKey}`} />
            ) : (
              <AgentRow key={agent.id} agent={agent} {...rowHandlers} />
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Don't see your agent? bb picks up other ACP agents once you have them
        installed.
      </p>
    </div>
  );
}

export interface OnboardingRepo {
  id: string;
  name: string;
  path: string;
  lastActive: string;
  remote: string | null;
  added: boolean;
}

type ProjectsStepStatus =
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "results"; truncated: boolean };

interface ProjectsStepProps {
  status: ProjectsStepStatus;
  repos: readonly OnboardingRepo[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onAddFolder: () => void;
  onRetry: () => void;
}

function SelectAllCheckbox({
  checked,
  ...props
}: Omit<CheckboxPrimitive.CheckboxProps, "className" | "children">) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      className={`peer size-4 shrink-0 rounded-sm border border-input shadow-xs ${CONTROL_HOVER_TRANSITION} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background data-[state=indeterminate]:border-foreground data-[state=indeterminate]:bg-foreground data-[state=indeterminate]:text-background`}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Icon
          name={checked === "indeterminate" ? "Minus" : "Check"}
          className="size-3.5"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function ProjectsStep({
  status,
  repos,
  selectedIds,
  onToggle,
  onSelectAll,
  onSelectNone,
  onAddFolder,
  onRetry,
}: ProjectsStepProps) {
  if (status.kind === "scanning") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="Spinner" aria-hidden className="size-3.5 animate-spin" />
          Looking for git repos you've touched recently…
        </div>
        <ul className={ONBOARDING_LIST_CLASS}>
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="flex items-center gap-3 px-3 py-3">
              <span className="size-4 rounded-sm bg-state-hover" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="h-3 w-32 rounded-sm bg-state-hover" />
                <span className="h-2.5 w-56 rounded-sm bg-state-hover" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (status.kind === "error" || repos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <Icon
          name="FolderGit"
          aria-hidden
          className="size-6 text-muted-foreground"
        />
        <p className="text-sm text-muted-foreground">
          {status.kind === "error"
            ? status.message
            : "bb didn't find a git repo you've worked in over the last 30 days."}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            {status.kind === "error" ? "Try again" : "Scan again"}
          </Button>
          <Button size="sm" variant="outline" onClick={onAddFolder}>
            <Icon name="FolderPlus" aria-hidden />
            Choose a folder
          </Button>
        </div>
      </div>
    );
  }

  const selectableCount = repos.filter((repo) => !repo.added).length;
  const selectedCount = repos.filter(
    (repo) => !repo.added && selectedIds.has(repo.id),
  ).length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  return (
    <div className="flex flex-col gap-3">
      <ul className={ONBOARDING_LIST_CLASS}>
        <li className="flex items-center rounded-t-lg bg-surface-recessed text-xs text-muted-foreground">
          <label
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 px-3 py-2",
              selectableCount > 0 && "cursor-pointer hover:text-foreground",
            )}
          >
            <SelectAllCheckbox
              aria-label={
                allSelected ? "Clear project selection" : "Select all projects"
              }
              checked={
                allSelected ? true : selectedCount > 0 ? "indeterminate" : false
              }
              disabled={selectableCount === 0}
              onCheckedChange={() =>
                allSelected ? onSelectNone() : onSelectAll()
              }
            />
            Select all
          </label>
          <span className="shrink-0 px-3 text-right tabular-nums">
            Last active
          </span>
        </li>
        {repos.map((repo) => (
          <li key={repo.id}>
            <label
              className={cn(
                "flex items-center gap-3 px-3 py-2.5",
                repo.added
                  ? "text-muted-foreground"
                  : "cursor-pointer hover:bg-state-hover",
              )}
            >
              <Checkbox
                checked={repo.added || selectedIds.has(repo.id)}
                disabled={repo.added}
                onCheckedChange={() => onToggle(repo.id)}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {repo.name}
                  </span>
                  {repo.remote ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {repo.remote}
                    </span>
                  ) : null}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {repo.path}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {repo.added ? "Already added" : repo.lastActive}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {status.truncated ? (
        <p className="text-xs text-muted-foreground">
          The scan ran out of time, so some repos may be missing.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onAddFolder}
        className="flex items-center gap-2 self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <Icon name="FolderPlus" aria-hidden className="size-3.5" />
        Add a folder that isn't listed
      </button>
    </div>
  );
}

export function OnboardingPluginGrid({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ResourceBrowseGrid
        className={cn(
          "w-full gap-2",
          compact
            ? "grid-cols-1"
            : "grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]",
        )}
      >
        {children}
      </ResourceBrowseGrid>
    </div>
  );
}

export function OnboardingPluginGridSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex min-h-36 flex-col gap-3 rounded-xl border border-border p-3"
        >
          <span className="h-4 w-32 rounded-sm bg-state-hover" />
          <span className="h-3 w-full rounded-sm bg-state-hover" />
          <span className="h-3 w-2/3 rounded-sm bg-state-hover" />
        </div>
      ))}
    </>
  );
}

interface OnboardingPluginCardProps {
  name: string;
  description: string;
  icon: { icon: string | null; iconUrl: string | null; iconTinted: boolean };
  enabled: boolean;
  unavailableReason: string | null;
  onToggle: (enabled: boolean) => void;
}

export function OnboardingPluginCard({
  name,
  description,
  icon,
  enabled,
  unavailableReason,
  onToggle,
}: OnboardingPluginCardProps) {
  const disabled = unavailableReason !== null;
  return (
    <PluginCard
      leading={
        <CatalogEntryIconChip compact entry={{ displayName: name, ...icon }} />
      }
      title={name}
      description={unavailableReason ?? description}
      descriptionLines={3}
      density="compact"
      disabled={disabled}
      byline={
        <PluginAuthorByline name="BB Official" github={null} official>
          BB Official
        </PluginAuthorByline>
      }
      footerAction={
        <label
          className={cn(
            "flex items-center gap-2",
            !disabled && "cursor-pointer",
          )}
        >
          <Switch
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onToggle}
            aria-label={`Enable ${name}`}
          />
        </label>
      }
      openLabel={`${enabled ? "Turn off" : "Turn on"} ${name}`}
      onOpen={() => {
        if (!disabled) onToggle(!enabled);
      }}
    />
  );
}

export function AgentInstallErrorDetails({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  const text = terminalOutputToPlainText(log);
  if (text.trim().length === 0) return null;
  return (
    <div className="mt-3">
      <InlinePanel
        hasBody={false}
        toggles={
          <DisclosureToggle expanded={open} onToggle={() => setOpen(!open)}>
            {open ? "Hide details" : "Show details"}
          </DisclosureToggle>
        }
        expanded={
          open ? (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-anywhere px-3 pb-3 pt-1 font-mono text-xs text-muted-foreground">
              {text}
            </pre>
          ) : null
        }
      >
        {null}
      </InlinePanel>
    </div>
  );
}

export function AgentSignInInstruction({
  agentName,
  view,
  onOpenUrl,
}: {
  agentName: string;
  view: AgentSignInView;
  onOpenUrl: (url: string) => void;
}) {
  const url = view.guide?.url ?? null;
  const userCode = view.guide?.userCode ?? null;
  const acceptsPastedCode = view.guide?.acceptsPastedCode ?? false;
  if (url === null) {
    return view.terminalVisible ? (
      <>Sign in to {agentName} in the terminal below.</>
    ) : (
      <>Sign in to {agentName} in the terminal.</>
    );
  }
  const siteName = signInSiteName(url);
  const link = (
    <InlineTextLink
      href={url}
      onOpen={(href) => {
        onOpenUrl(href);
        return true;
      }}
    >
      {siteName ?? "your browser"}
    </InlineTextLink>
  );
  const place = siteName === null ? <>in {link}</> : <>on {link}</>;
  if (userCode !== null) {
    return <>Enter this code {place}.</>;
  }
  if (acceptsPastedCode) {
    return <>Sign in {place}, then paste the code it shows you.</>;
  }
  return <>Sign in {place}.</>;
}

interface AgentSignInPanelProps {
  connect: boolean;
  agentName: string;
  view: AgentSignInView;
  code: string;
  codeSubmitted: boolean;
  terminal: ReactNode;
  onCodeChange: (code: string) => void;
  onSubmitCode: () => void;
  onCopy: (text: string) => void;
  onToggleTerminal: () => void;
}

export function AgentSignInPanel({
  connect,
  agentName,
  view,
  code,
  codeSubmitted,
  terminal,
  onCodeChange,
  onSubmitCode,
  onCopy,
  onToggleTerminal,
}: AgentSignInPanelProps) {
  const url = view.guide?.url ?? null;
  const userCode = view.guide?.userCode ?? null;
  const acceptsPastedCode = view.guide?.acceptsPastedCode ?? false;
  const variant: SignInPanelVariant = connect
    ? { kind: "waiting" }
    : url !== null && userCode !== null
      ? {
          kind: "code",
          code: userCode,
          label: `${agentName} sign-in code`,
          onCopyCode: onCopy,
        }
      : url !== null && acceptsPastedCode
        ? {
            kind: "paste",
            label: `${agentName} authorization code`,
            value: code,
            onChange: onCodeChange,
            onSubmit: onSubmitCode,
          }
        : { kind: "waiting" };
  if (!connect && !view.started) return null;
  return (
    <div className="mt-3">
      <SignInPanel
        status={!connect && codeSubmitted ? "Finishing sign-in…" : undefined}
        variant={variant}
        toggles={
          <DisclosureToggle
            expanded={view.terminalVisible}
            onToggle={onToggleTerminal}
          >
            {terminalToggleLabel(view.terminalVisible)}
          </DisclosureToggle>
        }
        expanded={
          view.terminalVisible ? <div className="h-48">{terminal}</div> : null
        }
      />
    </div>
  );
}

export function DevicesStep({
  hostName,
  connectSection,
  showMachines,
  addMachinePanel,
  onAddMachine,
  onCloseAddMachine,
}: {
  hostName: string | null;
  connectSection: ReactNode;
  showMachines: boolean;
  addMachinePanel: ReactNode;
  onAddMachine: () => void;
  onCloseAddMachine: () => void;
}) {
  const open = addMachinePanel !== null;
  return (
    <div className="flex flex-col gap-3">
      {connectSection === null ? null : (
        <SetupOptionGroup label="Where you use bb" labelHidden={!showMachines}>
          {connectSection}
        </SetupOptionGroup>
      )}
      {showMachines ? (
        <SetupOptionGroup label="Where agents run">
          <SetupOptionRow
            icon="Laptop"
            title="Add another machine"
            description={`${hostName === null ? "This computer" : `This computer, ${hostName},`} is your bb server. Add laptops or cloud machines that connect to it and run agents. Manage machines anytime in Settings > Machines.`}
            actionStaysInline={open}
            action={
              open ? (
                <RowDismissButton
                  label="Close adding a machine"
                  tooltip="Close"
                  onClick={onCloseAddMachine}
                />
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onAddMachine}
                >
                  Add a machine
                </Button>
              )
            }
            footer={
              open ? (
                <div className="border-t border-border-hairline bg-surface-recessed p-3">
                  {addMachinePanel}
                </div>
              ) : null
            }
          />
        </SetupOptionGroup>
      ) : null}
    </div>
  );
}
