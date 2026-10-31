import { ExpandableText } from "@bb/shared-ui/expandable-text";
import { useState, type ReactNode } from "react";
import type { ExperimentalProviderIconProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { ResourceBrowseGrid } from "@bb/shared-ui/resource-list";
import {
  DisclosureToggle,
  InlineTextButton,
  InlineTextLink,
  SignInPanel,
  type SignInPanelVariant,
} from "@bb/shared-ui/sign-in-panel";
import {
  SetupOptionGroup,
  SetupOptionRow,
} from "@bb/shared-ui/setup-option-row";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PluginAuthorByline,
  PluginCard,
} from "@/components/plugin/management/PluginCard";
import { CatalogEntryIconChip } from "@/components/plugin/management/plugin-ui";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
} from "@/lib/bb-desktop";
import {
  ONBOARDING_STEPS,
  type AgentSetupState,
  type OnboardingStepId,
  type SignInGuide,
} from "./onboarding-model";
import bbLogoUrl from "../../../../../assets/bb-logo.svg";

const CONTENT_COLUMN_CLASS =
  "mx-auto w-full max-w-[600px] px-4 @xl/onboarding:px-6";

interface OnboardingLayoutProps {
  step: OnboardingStepId;
  width?: "default" | "wide";
  showSkipAll?: boolean;
  skippedSteps?: ReadonlySet<OnboardingStepId>;
  composition?: "docked" | "centered";
  compact?: boolean;
  reserveMacosTrafficLights?: boolean;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footerNote?: ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  secondaryLabel?: string;
  onPrimary: () => void;
  onSecondary?: () => void;
  onBack?: () => void;
  onSelectStep: (step: OnboardingStepId) => void;
  onSkipAll: () => void;
}

export function OnboardingLayout({
  step,
  width = "default",
  showSkipAll = true,
  skippedSteps,
  composition = "docked",
  compact = false,
  reserveMacosTrafficLights = false,
  title,
  description,
  children,
  footerNote,
  primaryLabel,
  primaryDisabled = false,
  primaryBusy = false,
  secondaryLabel,
  onPrimary,
  onSecondary,
  onBack,
  onSelectStep,
  onSkipAll,
}: OnboardingLayoutProps) {
  const activeIndex = ONBOARDING_STEPS.findIndex((entry) => entry.id === step);
  const centered = composition === "centered";
  const actions = (
    <>
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon name="ArrowLeft" aria-hidden />
          Back
        </Button>
      ) : null}
      {centered ? null : (
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {footerNote}
        </span>
      )}
      {secondaryLabel && onSecondary ? (
        <Button variant="ghost" size="sm" onClick={onSecondary}>
          {secondaryLabel}
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
    </>
  );
  return (
    <div
      data-testid="onboarding"
      className="@container/onboarding flex min-h-0 flex-1 flex-col bg-background text-foreground"
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
        {showSkipAll ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "col-start-3 row-start-1 shrink-0 text-muted-foreground",
              MACOS_APP_REGION_NO_DRAG_CLASS,
            )}
            onClick={onSkipAll}
          >
            <span className="@xl/onboarding:hidden">Skip</span>
            <span className="hidden @xl/onboarding:inline">Skip setup</span>
          </Button>
        ) : (
          <span aria-hidden className="col-start-3 row-start-1 w-6" />
        )}
      </header>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          centered && "flex flex-col",
        )}
      >
        <div
          className={cn(
            CONTENT_COLUMN_CLASS,
            width === "wide" && "max-w-3xl",
            "flex flex-col",
            centered ? "gap-5" : "gap-6",
            compact ? "py-4" : "py-6",
            centered && "pt-8",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-1.5",
              centered && "items-center text-center",
            )}
          >
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
          {centered ? (
            <div className="sticky bottom-0 flex flex-col items-center gap-2 bg-background pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-gradient-to-t before:from-background before:to-transparent">
              {footerNote ? (
                <p className="text-center text-xs text-muted-foreground">
                  {footerNote}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {actions}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {centered ? null : (
        <footer className="shrink-0 border-t border-border-hairline">
          <div
            className={cn(
              CONTENT_COLUMN_CLASS,
              "flex items-center gap-1 py-3 @xl/onboarding:gap-2",
            )}
          >
            {actions}
          </div>
        </footer>
      )}
    </div>
  );
}

export interface OnboardingAgent {
  id: string;
  name: string;
  provider: ExperimentalProviderIconProps["provider"];
  state: AgentSetupState;
  expanded?: ReactNode;
}

function agentSubline(state: AgentSetupState): string {
  switch (state.status) {
    case "checking":
      return "Checking…";
    case "ready":
      return state.detail ?? "Signed in";
    case "signIn":
      return state.reason === "failed"
        ? "Sign-in didn't finish · try again"
        : state.reason === "expired"
          ? "Installed · your session expired"
          : "Installed · not signed in";
    case "signingIn":
      return "Finish signing in below";
    case "install":
      return "Not installed";
    case "update":
      return state.detail ?? "Update needed";
    case "installing":
      return "Installing…";
    case "installFailed":
      return state.message;
    case "unknown":
      return state.message ?? "Couldn't check this agent";
  }
}

interface AgentRowHandlers {
  onSignIn: (id: string) => void;
  onInstall: (id: string) => void;
  onViewInstallLog: (id: string) => void;
  onCancelSignIn: (id: string) => void;
}

function AgentActionIcon({
  agent,
  quiet,
}: {
  agent: OnboardingAgent;
  quiet: boolean;
}) {
  return quiet ? (
    <ProviderIcon
      providerKind="agent"
      provider={agent.provider}
      className="size-4"
    />
  ) : (
    <Icon name="Download" aria-hidden />
  );
}

function AgentRow({
  agent,
  quiet,
  onSignIn,
  onInstall,
  onViewInstallLog,
  onCancelSignIn,
}: AgentRowHandlers & { agent: OnboardingAgent; quiet: boolean }) {
  const { state } = agent;
  const loudFailure = state.status === "installFailed" && !quiet;
  return (
    <li className="px-3 py-3" data-agent-id={agent.id}>
      <div
        className={cn(
          "items-center gap-3",
          loudFailure
            ? "grid grid-cols-[1.5rem_minmax(0,1fr)] @xl/onboarding:flex"
            : "flex",
        )}
      >
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
          <ExpandableText
            expandLabel="Show details"
            className={cn(
              "text-xs text-muted-foreground",
              loudFailure && "text-destructive-text",
            )}
          >
            {agentSubline(state)}
          </ExpandableText>
        </div>
        <div className="col-start-2 flex shrink-0 items-center justify-end gap-2">
          {state.status === "checking" || state.status === "installing" ? (
            <Icon
              name="Spinner"
              aria-hidden
              className="size-4 animate-spin text-muted-foreground"
            />
          ) : null}
          {state.status === "ready" ? (
            quiet ? (
              <span className="flex items-center gap-1 text-2xs text-subtle-foreground">
                <Icon name="CircleCheck" aria-hidden className="size-3" />
                Ready
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-success">
                <Icon name="CircleCheck" aria-hidden className="size-4" />
                Ready
              </span>
            )
          ) : null}
          {state.status === "signIn" && state.canSignIn ? (
            <Button
              size="sm"
              variant={quiet ? "outline" : "default"}
              onClick={() => onSignIn(agent.id)}
            >
              {quiet ? <AgentActionIcon agent={agent} quiet /> : null}
              Sign in
            </Button>
          ) : null}
          {loudFailure ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onViewInstallLog(agent.id)}
            >
              View log
            </Button>
          ) : null}
          {(state.status === "install" ||
            state.status === "update" ||
            state.status === "installFailed") &&
          state.canInstall ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInstall(agent.id)}
            >
              <AgentActionIcon agent={agent} quiet={quiet} />
              {state.status === "installFailed"
                ? "Retry"
                : state.status === "update"
                  ? "Update"
                  : "Install"}
            </Button>
          ) : null}
          {state.status === "signingIn" && !quiet ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onCancelSignIn(agent.id)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      {agent.expanded}
    </li>
  );
}

interface AgentStepProps extends AgentRowHandlers {
  quiet?: boolean;
  machineName: string | null;
  agents: readonly OnboardingAgent[] | null;
  onRecheck: () => void;
}

export function AgentStep({
  quiet = false,
  machineName,
  agents,
  onRecheck,
  ...rowHandlers
}: AgentStepProps) {
  return (
    <div className="flex flex-col gap-3">
      {quiet ? null : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="Laptop" aria-hidden className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">
            {machineName === null
              ? "Waiting for this computer to connect…"
              : `On ${machineName}`}
          </span>
          {machineName === null ? null : (
            <button
              type="button"
              onClick={onRecheck}
              className="flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon
                name="ArrowReloadHorizontal"
                aria-hidden
                className="size-3.5"
              />
              Check again
            </button>
          )}
        </div>
      )}
      {agents === null ? (
        <ul className="divide-y divide-border-hairline rounded-lg border border-border">
          {[0, 1, 2].map((index) => (
            <li key={index} className="flex items-center gap-3 px-3 py-3">
              <span className="size-6 rounded-md bg-state-hover" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="h-3 w-28 rounded-sm bg-state-hover" />
                <span className="h-2.5 w-40 rounded-sm bg-state-hover" />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border-hairline rounded-lg border border-border">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              quiet={quiet}
              {...rowHandlers}
            />
          ))}
        </ul>
      )}
      {quiet ? null : (
        <p className="text-xs text-muted-foreground">
          Don't see your agent? bb picks up other ACP agents, such as opencode,
          once they are installed.
        </p>
      )}
    </div>
  );
}

interface AgentSignInGuideProps {
  agentName: string;
  guide: SignInGuide | null;
  code: string;
  codeSubmitted: boolean;
  terminalVisible: boolean;
  terminal: ReactNode;
  onCodeChange: (code: string) => void;
  onSubmitCode: () => void;
  onOpenUrl: (url: string) => void;
  onCopy: (text: string) => void;
  onToggleTerminal: () => void;
  alternateLabel: string | null;
  onUseAlternate: () => void;
}

export function AgentSignInGuide({
  agentName,
  guide,
  code,
  codeSubmitted,
  terminalVisible,
  terminal,
  onCodeChange,
  onSubmitCode,
  onOpenUrl,
  onCopy,
  onToggleTerminal,
  alternateLabel,
  onUseAlternate,
}: AgentSignInGuideProps) {
  const url = guide?.url ?? null;
  const userCode = guide?.userCode ?? null;
  const acceptsPastedCode = guide?.acceptsPastedCode ?? false;
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-surface-recessed">
      <div className="flex flex-col gap-3 p-3">
        {url === null ? (
          terminalVisible ? (
            <p className="text-xs text-muted-foreground">
              Sign in to {agentName} in the terminal below.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon
                name="Spinner"
                aria-hidden
                className="size-3.5 animate-spin"
              />
              Starting {agentName} sign-in…
            </p>
          )
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {userCode !== null
                ? `Open the ${agentName} sign-in page and enter this code.`
                : acceptsPastedCode
                  ? `Sign in on the ${agentName} page, then paste the code it shows you.`
                  : `Finish signing in on the ${agentName} page.`}
            </p>
            {userCode === null ? null : (
              <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-3">
                <span
                  aria-label={`${agentName} sign-in code`}
                  className="select-all font-mono text-xl font-semibold tracking-widest"
                >
                  {userCode}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy sign-in code"
                  onClick={() => onCopy(userCode)}
                >
                  <Icon name="Copy" aria-hidden />
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onOpenUrl(url)}>
                Open sign-in page
                <Icon name="ExternalLink" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => onCopy(url)}
              >
                <Icon name="Copy" aria-hidden />
                Copy link
              </Button>
            </div>
            {acceptsPastedCode && userCode === null ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSubmitCode();
                }}
              >
                <input
                  value={code}
                  onChange={(event) => onCodeChange(event.target.value)}
                  aria-label={`${agentName} authorization code`}
                  placeholder="Paste the code here"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={code.trim().length === 0}
                >
                  Complete
                </Button>
              </form>
            ) : null}
          </>
        )}
      </div>
      {terminalVisible ? (
        <div className="h-48 border-t border-border-hairline">{terminal}</div>
      ) : null}
      <div className="flex items-center gap-2 border-t border-border-hairline px-3 py-2 text-xs text-muted-foreground">
        <Icon name="Spinner" aria-hidden className="size-3.5 animate-spin" />
        <span className="min-w-0 flex-1">
          {codeSubmitted
            ? "Finishing sign-in…"
            : "bb continues on its own as soon as you're signed in."}
        </span>
        {alternateLabel === null ? null : (
          <button
            type="button"
            onClick={onUseAlternate}
            className="shrink-0 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {alternateLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleTerminal}
          className="shrink-0 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {terminalVisible ? "Hide terminal" : "Show terminal"}
        </button>
      </div>
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
        <ul className="divide-y divide-border-hairline rounded-lg border border-border">
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {selectedIds.size} of {selectableCount} selected
        </span>
        <button
          type="button"
          className="hover:text-foreground"
          onClick={onSelectAll}
        >
          Select all
        </button>
        <button
          type="button"
          className="hover:text-foreground"
          onClick={onSelectNone}
        >
          Select none
        </button>
      </div>
      <ul className="divide-y divide-border-hairline rounded-lg border border-border">
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
  showHelp = true,
  children,
}: {
  compact?: boolean;
  showHelp?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", showHelp ? "gap-4" : "gap-2")}>
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
      {showHelp ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="Puzzle" aria-hidden className="size-3.5 shrink-0" />
          Want something that isn't here? Ask an agent to build a plugin at any
          time.
        </p>
      ) : null}
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
  density?: "default" | "compact";
  showStateLabel?: boolean;
  name: string;
  description: string;
  icon: { icon: string | null; iconUrl: string | null; iconTinted: boolean };
  enabled: boolean;
  pending: boolean;
  unavailableReason: string | null;
  onToggle: (enabled: boolean) => void;
}

export function OnboardingPluginCard({
  density = "default",
  showStateLabel = true,
  name,
  description,
  icon,
  enabled,
  pending,
  unavailableReason,
  onToggle,
}: OnboardingPluginCardProps) {
  const disabled = pending || unavailableReason !== null;
  return (
    <PluginCard
      leading={
        <CatalogEntryIconChip compact entry={{ displayName: name, ...icon }} />
      }
      title={name}
      description={unavailableReason ?? description}
      descriptionLines={density === "compact" ? 3 : "expandable"}
      density={density}
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
          {pending ? (
            <Icon
              name="Spinner"
              aria-hidden
              className="size-3.5 animate-spin"
            />
          ) : !showStateLabel ? null : enabled ? (
            "On"
          ) : (
            "Off"
          )}
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

function CopyableLine({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-surface-recessed py-1 pl-3 pr-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Copy address"
        onClick={() => onCopy(value)}
      >
        <Icon name="Copy" aria-hidden />
      </Button>
    </div>
  );
}

interface DeviceRowProps {
  icon: IconName;
  title: string;
  description: string;
  action: ReactNode;
  children?: ReactNode;
}

function DeviceRow({
  icon,
  title,
  description,
  action,
  children,
}: DeviceRowProps) {
  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <Icon
          name={icon}
          aria-hidden
          className="size-5 shrink-0 text-subtle-foreground"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        {action}
      </div>
      {children}
    </li>
  );
}

export type OnboardingConnectState =
  | { status: "on"; url: string }
  | { status: "off" }
  | { status: "unavailable" };

interface DevicesStepProps {
  connect: OnboardingConnectState;
  connectSetup: ReactNode;
  connectSetupOpen: boolean;
  otherMachineCount: number;
  mobileLinks: { ios: string; android: string };
  onToggleConnectSetup: () => void;
  onCopyConnectUrl: (url: string) => void;
  onAddMachine: () => void;
}

export function DevicesStep({
  connect,
  connectSetup,
  connectSetupOpen,
  otherMachineCount,
  mobileLinks,
  onToggleConnectSetup,
  onCopyConnectUrl,
  onAddMachine,
}: DevicesStepProps) {
  return (
    <ul className="divide-y divide-border-hairline rounded-lg border border-border">
      <DeviceRow
        icon="ComputerCloud"
        title="Open bb from any browser"
        description={
          connect.status === "unavailable"
            ? "bb connect is turned off on this server. Enable its plugin to get a private getbb.app address."
            : "bb connect gives this bb a private getbb.app address that only you can open."
        }
        action={
          connect.status === "on" ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <Icon name="CircleCheck" aria-hidden className="size-4" />
              On
            </span>
          ) : connect.status === "off" ? (
            <Button size="sm" variant="outline" onClick={onToggleConnectSetup}>
              {connectSetupOpen ? "Hide" : "Set up"}
            </Button>
          ) : null
        }
      >
        {connect.status === "on" ? (
          <CopyableLine value={connect.url} onCopy={onCopyConnectUrl} />
        ) : null}
        {connect.status === "off" && connectSetupOpen ? (
          <div className="mt-3 rounded-md border border-border p-3">
            {connectSetup}
          </div>
        ) : null}
      </DeviceRow>
      <DeviceRow
        icon="Laptop"
        title="Add another machine"
        description={
          otherMachineCount > 0
            ? `${otherMachineCount} other ${otherMachineCount === 1 ? "machine is" : "machines are"} already connected. Add more to run agents on a server, a desktop, or a cloud box.`
            : "Run agents on a server, a desktop, or a cloud box and steer them all from here."
        }
        action={
          <Button size="sm" variant="outline" onClick={onAddMachine}>
            Add machine
          </Button>
        }
      />
      <DeviceRow
        icon="Smartphone"
        title="Get the mobile app"
        description="Get a push when a thread needs you."
        action={
          <span className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href={mobileLinks.ios} target="_blank" rel="noreferrer">
                iOS
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={mobileLinks.android} target="_blank" rel="noreferrer">
                Android
              </a>
            </Button>
          </span>
        }
      />
    </ul>
  );
}

export function AgentInstallErrorDetails({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  if (log.trim().length === 0) return null;
  return (
    <div className="mt-1 flex flex-col items-start gap-1 pl-8 text-xs text-muted-foreground">
      <DisclosureToggle expanded={open} onToggle={() => setOpen(!open)}>
        {open ? "Hide details" : "Show details"}
      </DisclosureToggle>
      {open ? (
        <pre className="max-h-32 w-full overflow-auto whitespace-pre-wrap px-1 font-mono text-xs text-muted-foreground">
          {log}
        </pre>
      ) : null}
    </div>
  );
}

interface AgentSignInPanelProps {
  agentName: string;
  guide: SignInGuide | null;
  code: string;
  codeSubmitted: boolean;
  terminalVisible: boolean;
  terminal: ReactNode;
  alternate: "browser" | "code" | null;
  onCodeChange: (code: string) => void;
  onSubmitCode: () => void;
  onOpenUrl: (url: string) => void;
  onCopy: (text: string) => void;
  onToggleTerminal: () => void;
  onUseAlternate: () => void;
}

export function AgentSignInPanel({
  agentName,
  guide,
  code,
  codeSubmitted,
  terminalVisible,
  terminal,
  alternate,
  onCodeChange,
  onSubmitCode,
  onOpenUrl,
  onCopy,
  onToggleTerminal,
  onUseAlternate,
}: AgentSignInPanelProps) {
  const url = guide?.url ?? null;
  const userCode = guide?.userCode ?? null;
  const acceptsPastedCode = guide?.acceptsPastedCode ?? false;
  const starting = url === null && !terminalVisible;
  const page =
    url === null ? null : (
      <InlineTextLink
        href={url}
        onOpen={(href) => {
          onOpenUrl(href);
          return true;
        }}
      >
        {agentName} page
      </InlineTextLink>
    );
  const alternateAction =
    alternate === null ? null : (
      <InlineTextButton onClick={onUseAlternate}>
        {alternate === "browser"
          ? "sign in with a browser"
          : "use a code instead"}
      </InlineTextButton>
    );
  const instruction =
    url === null ? (
      terminalVisible ? (
        `Sign in to ${agentName} in the terminal below.`
      ) : undefined
    ) : userCode !== null ? (
      alternateAction === null ? (
        <>Enter this code on the {page}.</>
      ) : (
        <>
          Enter this code on the {page}, or {alternateAction}.
        </>
      )
    ) : acceptsPastedCode ? (
      <>Sign in on the {page}, then paste the code it shows you.</>
    ) : alternate === "code" ? (
      <>Sign in with your browser, or {alternateAction}.</>
    ) : (
      <>Finish signing in on the {page}.</>
    );
  const variant: SignInPanelVariant =
    url !== null && userCode !== null
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
  return (
    <div className="mt-3 pl-9">
      <SignInPanel
        status={
          codeSubmitted
            ? "Finishing sign-in…"
            : starting
              ? `Starting ${agentName} sign-in…`
              : "bb continues automatically after you sign in."
        }
        instruction={instruction}
        variant={variant}
        toggles={
          <DisclosureToggle
            expanded={terminalVisible}
            onToggle={onToggleTerminal}
          >
            {terminalVisible ? "Hide terminal" : "Show terminal"}
          </DisclosureToggle>
        }
        expanded={
          terminalVisible ? <div className="h-48">{terminal}</div> : null
        }
      />
    </div>
  );
}

export function ConnectUnavailableRow() {
  return (
    <SetupOptionRow
      icon="ComputerCloud"
      title="bb connect"
      description="bb connect is turned off on this server. Turn on its plugin to get a private getbb.app address."
    />
  );
}

export function RedesignedDevicesStep({
  hostName,
  connectSection,
  onAddMachine,
}: {
  hostName: string | null;
  connectSection: ReactNode;
  onAddMachine: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SetupOptionGroup label="Where you use bb">
        {connectSection}
      </SetupOptionGroup>
      <SetupOptionGroup label="Where agents run">
        <SetupOptionRow
          icon="Laptop"
          title="Add another machine"
          description={`${hostName === null ? "This computer" : `This computer, ${hostName},`} is your bb server. Add laptops or cloud machines that connect to it and run agents. Manage machines anytime in Settings → Machines.`}
          action={
            <Button
              size="sm"
              variant="ghost"
              className="-mr-3 text-muted-foreground hover:text-foreground @max-xl/onboarding:mr-0 @max-xl/onboarding:-ml-3"
              onClick={onAddMachine}
            >
              Add a machine
            </Button>
          }
        />
      </SetupOptionGroup>
    </div>
  );
}
