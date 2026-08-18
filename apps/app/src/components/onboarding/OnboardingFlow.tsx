import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { OnboardingAgent } from "@bb/server-contract";
import type { DiscoveredRepo } from "@bb/host-daemon-contract";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { useLocalPathPicker } from "@/hooks/useLocalPathPicker";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  useOnboardingAgents,
  useOnboardingRepos,
} from "@/hooks/queries/system-queries";

/**
 * First-run onboarding.
 *
 * Two steps in a modal over the real app shell. The first is a *confirmation*
 * whenever the machine already has a usable agent — bb runs the coding agent
 * CLIs that are already installed and bills inference to those plans, so the
 * honest thing to do is state that rather than ask a question. Only a machine
 * with nothing installed is asked to install something.
 *
 * Escape and the close button both exit to the app; outside-click is blocked so
 * a stray click cannot dismiss setup mid-install.
 */

export type OnboardingAgentState = "connected" | "signed_out" | "none";

export interface OnboardingFlowProps {
  /** Adds the selected projects; resolves once they exist. */
  onAddProjects: (repos: readonly DiscoveredRepo[]) => Promise<void>;
  /** Called when the flow finishes or is dismissed — persists the flag. */
  onClose: (outcome: {
    completed: boolean;
    step: "agents" | "projects";
    projectsAdded: number;
    agentState: OnboardingAgentState;
  }) => void;
  /** Reports funnel events; the app wires this to the server's telemetry. */
  onEvent?: (event: OnboardingUiEvent) => void;

  /** Starts the managed CLI install; resolves when the job is queued. */
  onInstallAgent: (agent: OnboardingAgent) => void;
  /** Set of provider ids with an install running or queued. */
  installing: ReadonlySet<string>;
}

export type OnboardingUiEvent =
  | { name: "started"; agentState: OnboardingAgentState; agentCount: number }
  | { name: "step_completed"; step: "agents" | "projects" }
  /** Distinct from completion so the funnel can tell the two apart. */
  | { name: "step_skipped"; step: "agents" | "projects" };

/** The real brand mark the rest of the app uses for this provider. */
function ProviderMark({ providerId }: { providerId: string }) {
  const info = getProviderIconInfo(providerId);
  if (!info) {
    return (
      <Icon
        name="Code"
        className="size-4 shrink-0 text-subtle-foreground"
        aria-hidden
      />
    );
  }
  const Mark = info.icon;
  return <Mark className="size-4 shrink-0 text-subtle-foreground" />;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {children}
    </div>
  );
}

/** Two-step progress, sized for a dialog footer. */
function StepDots({ current }: { current: number }) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Step ${current + 1} of 2`}
    >
      {[0, 1].map((index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 rounded-full transition-all",
            index === current ? "w-4 bg-foreground" : "w-1.5 bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function agentStateOf(
  agents: readonly OnboardingAgent[],
): OnboardingAgentState {
  if (agents.some((agent) => agent.status === "connected")) return "connected";
  if (agents.some((agent) => agent.status !== "not_installed"))
    return "signed_out";
  return "none";
}

function AgentRows({
  agents,
  onInstall,
  installing,
  expandedSignIn,
  onToggleSignIn,
  onRecheck,
}: {
  agents: readonly OnboardingAgent[];
  onInstall: (agent: OnboardingAgent) => void;
  installing: ReadonlySet<string>;
  expandedSignIn: string | null;
  onToggleSignIn: (providerId: string | null) => void;
  onRecheck: () => void;
}) {
  return (
    <Card>
      {agents.map((agent) => {
        const isInstalling = installing.has(agent.providerId);
        const connected = agent.status === "connected";
        const needsAuth =
          !isInstalling &&
          (agent.status === "unauthenticated" || agent.status === "expired");
        const expanded = expandedSignIn === agent.providerId;
        const label = isInstalling
          ? "Installing…"
          : connected
            ? "Connected"
            : agent.status === "expired"
              ? "Session expired"
              : agent.status === "unauthenticated"
                ? "Not signed in"
                : "Not installed";
        return (
          <div key={agent.providerId}>
            <div
              className={cn(
                // Fixed row height so every row shares one rhythm.
                "flex h-14 items-center gap-3 border-b border-border-hairline px-4 last:border-b-0",
                needsAuth && "bg-surface-attention",
              )}
            >
              <ProviderMark providerId={agent.providerId} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{agent.displayName}</div>
                {agent.accountEmail === null ? null : (
                  <div className="truncate text-xs text-subtle-foreground">
                    {agent.accountEmail}
                  </div>
                )}
              </div>
              {/* Fixed column so plan badges share one right edge, and rows
                  without a plan keep the same gutter. Only Claude Code, Codex,
                  and Cursor can report a plan; the rest get no badge rather
                  than a fabricated one. */}
              <span className="flex w-24 shrink-0 justify-end">
                {agent.planLabel === null ? null : (
                  <Badge variant="secondary" className="font-normal">
                    {agent.planLabel}
                  </Badge>
                )}
              </span>
              <span
                className={cn(
                  "flex w-36 shrink-0 items-center justify-end gap-1.5 text-right text-xs whitespace-nowrap",
                  // In-progress is neutral: only a state the user must act on
                  // earns the warning colour.
                  isInstalling
                    ? "text-subtle-foreground"
                    : connected
                      ? "text-success"
                      : "text-warning-text",
                )}
              >
                {label}
                {isInstalling ? (
                  <Icon
                    name="Spinner"
                    className="size-3.5 animate-spin"
                    aria-hidden
                  />
                ) : null}
              </span>
              <div className="w-20 shrink-0">
                {needsAuth && agent.loginCommand !== null ? (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      onToggleSignIn(expanded ? null : agent.providerId)
                    }
                  >
                    Sign in
                  </Button>
                ) : agent.status === "not_installed" &&
                  agent.canInstall &&
                  !isInstalling ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => onInstall(agent)}
                  >
                    Install
                  </Button>
                ) : null}
              </div>
            </div>
            {expanded && agent.loginCommand !== null ? (
              /* bb deliberately does not drive another tool's login: it shows
                 the agent's own command and re-checks, so credentials never
                 pass through bb. */
              <div className="space-y-2 border-b border-border-hairline bg-surface-recessed px-4 py-3">
                <p className="text-xs text-subtle-foreground">
                  Run this in a terminal, then come back:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs">
                    {agent.loginCommand}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void copyToClipboardWithToast(agent.loginCommand ?? "", {
                        successMessage: null,
                        errorMessage: null,
                      });
                    }}
                  >
                    Copy
                  </Button>
                  <Button size="sm" onClick={onRecheck}>
                    I&apos;ve signed in
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}

export function OnboardingFlow({
  onAddProjects,
  onClose,
  onEvent,
  onInstallAgent,
  installing,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<0 | 1>(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expandedSignIn, setExpandedSignIn] = useState<string | null>(null);
  /** Folders the user picked by hand, shown and checked alongside the scan. */
  const [addedRepos, setAddedRepos] = useState<readonly DiscoveredRepo[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [startedReported, setStartedReported] = useState(false);

  // Poll only while the agents step is visible; the projects step has no use
  // for it and each read is several host round-trips.
  const agentsQuery = useOnboardingAgents({ poll: step === 0 });
  // Re-read after a terminal sign-in rather than waiting out the poll. Using the
  // query's own refetch keeps cache writes inside the query layer.
  const recheck = useCallback(() => {
    void agentsQuery.refetch();
  }, [agentsQuery]);
  const reposQuery = useOnboardingRepos({ enabled: step === 1 });

  const agents = useMemo(
    () => agentsQuery.data?.agents ?? [],
    [agentsQuery.data],
  );
  const agentState = agentStateOf(agents);
  const scanningAgents = agentsQuery.isPending;

  // Only a machine with nothing installed is asked to install something.
  const nothingInstalled =
    !scanningAgents &&
    agents.length > 0 &&
    agents.every((agent) => agent.status === "not_installed");
  const canContinue =
    !scanningAgents && agents.some((agent) => agent.status === "connected");

  useEffect(() => {
    if (startedReported || scanningAgents) return;
    // A failed probe is not evidence of an empty machine; reporting it would
    // inflate `agent_state: none`, the metric this event exists to answer.
    if (agentsQuery.isError || agentsQuery.data === undefined) return;
    setStartedReported(true);
    onEvent?.({
      name: "started",
      agentState,
      agentCount: agents.filter((agent) => agent.status !== "not_installed")
        .length,
    });
  }, [
    agentState,
    agents,
    agentsQuery.data,
    agentsQuery.isError,
    onEvent,
    scanningAgents,
    startedReported,
  ]);

  const repos = useMemo<readonly DiscoveredRepo[]>(() => {
    const discovered = reposQuery.data?.repos ?? [];
    const seen = new Set(discovered.map((repo) => repo.path));
    // Hand-picked folders lead: the user just chose them.
    return [
      ...addedRepos.filter((repo) => !seen.has(repo.path)),
      ...discovered,
    ];
  }, [addedRepos, reposQuery.data]);

  // Same path-entry surface the rest of the app uses (native picker on a
  // single-machine desktop, in-app browser otherwise). Onboarding's submit adds
  // the folder to this step's list instead of creating a project immediately,
  // so one "Add projects" click still creates everything at once.
  const pathPicker = useLocalPathPicker({
    isPending: false,
    submit: ({ path, closeDialog }) => {
      const name = path.split("/").filter(Boolean).pop() ?? path;
      setAddedRepos((current) =>
        current.some((repo) => repo.path === path)
          ? current
          : [
              ...current,
              {
                path,
                name,
                lastActivityAt: new Date().toISOString(),
                originUrl: null,
                agentSeen: false,
                agentSeenAt: null,
              },
            ],
      );
      setSelected((current) => new Set(current).add(path));
      closeDialog();
    },
  });

  // Pre-check repos an agent has already worked in — that is the strongest
  // signal the user wants them in bb — and fall back to the most recent.
  useEffect(() => {
    if (reposQuery.data === undefined) return;
    setSelected((current) => {
      if (current.size > 0) return current;
      const seen = repos.filter((repo) => repo.agentSeen).map((r) => r.path);
      return new Set(
        seen.length > 0 ? seen : repos.slice(0, 2).map((r) => r.path),
      );
    });
  }, [repos, reposQuery.data]);

  const finish = useCallback(
    (completed: boolean, atStep: "agents" | "projects", added: number) => {
      onClose({ completed, step: atStep, projectsAdded: added, agentState });
    },
    [agentState, onClose],
  );

  const toggleRepo = useCallback((path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const addProjects = useCallback(async () => {
    const chosen = repos.filter((repo) => selected.has(repo.path));
    setAdding(true);
    setAddError(null);
    try {
      await onAddProjects(chosen);
      onEvent?.({ name: "step_completed", step: "projects" });
      finish(true, "projects", chosen.length);
    } catch (error) {
      // Keep the dialog open and say so, rather than stranding the user with a
      // half-added set and no explanation.
      setAddError(
        error instanceof Error
          ? error.message
          : "Could not add every project. Try again.",
      );
    } finally {
      setAdding(false);
    }
  }, [finish, onAddProjects, onEvent, repos, selected]);

  const title =
    step === 0
      ? nothingInstalled
        ? "Install a coding agent"
        : "bb uses your existing coding agents"
      : "Add your projects";

  const description =
    step === 0
      ? nothingInstalled
        ? "bb has no inference of its own. It runs coding agent CLIs on your computer and bills usage to their plans. Install one to get started."
        : "It runs the agents below locally, so inference is billed to their plans."
      : "bb works inside your code. Add the folders you want it to work in. You can add more any time.";

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return;
        finish(false, step === 0 ? "agents" : "projects", 0);
      }}
    >
      <DialogContent
        className="max-w-[640px] gap-0 p-0 outline-none"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[420px] overflow-y-auto px-6 pb-5">
          {step === 0 ? (
            scanningAgents ? (
              <div className="flex items-center gap-2 py-6 text-sm text-subtle-foreground">
                <Icon
                  name="Spinner"
                  className="size-4 animate-spin"
                  aria-hidden
                />
                Checking which coding agents are installed…
              </div>
            ) : (
              <AgentRows
                agents={
                  nothingInstalled
                    ? agents.filter((agent) => agent.canInstall)
                    : agents.filter((agent) => agent.status !== "not_installed")
                }
                expandedSignIn={expandedSignIn}
                installing={installing}
                onInstall={onInstallAgent}
                onRecheck={recheck}
                onToggleSignIn={setExpandedSignIn}
              />
            )
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-subtle-foreground">
                {reposQuery.isPending
                  ? "Searching ~ for git repos…"
                  : `Found ${reposQuery.data?.repos.length ?? 0} repos you edited in the last 30 days`}
              </p>
              {reposQuery.isPending ? null : (
                <Card>
                  {repos.map((repo) => (
                    <div
                      key={repo.path}
                      onClick={() => toggleRepo(repo.path)}
                      className={cn(
                        "flex h-14 cursor-pointer items-center gap-3 border-b border-border-hairline px-4 last:border-b-0",
                        // Hover only applies to unselected rows. `state-hover`
                        // replaces the background rather than layering over it,
                        // so applying both made a hovered selected row read
                        // *lighter* than its selected neighbours.
                        selected.has(repo.path)
                          ? "bg-surface-selected"
                          : "hover:bg-state-hover",
                      )}
                    >
                      <Checkbox
                        checked={selected.has(repo.path)}
                        aria-label={`Add ${repo.name}`}
                      />
                      <Icon
                        name="FolderGit"
                        className="size-4 shrink-0 text-subtle-foreground"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{repo.name}</div>
                        <div className="truncate font-mono text-xs text-subtle-foreground">
                          {repo.path}
                        </div>
                      </div>
                      <span className="text-xs text-subtle-foreground">
                        {new Date(repo.lastActivityAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </Card>
              )}
              <Card>
                <div
                  onClick={() => pathPicker.openPathEntry({ kind: "create" })}
                  className="flex h-14 cursor-pointer items-center gap-3 px-4 hover:bg-state-hover"
                >
                  <Icon
                    name="FolderPlus"
                    className="size-4 shrink-0 text-subtle-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">Add a folder</div>
                    <div className="text-xs text-subtle-foreground">
                      Choose a project outside your home directory
                    </div>
                  </div>
                  <span className="text-xs text-subtle-foreground">
                    Browse…
                  </span>
                </div>
              </Card>
              {addError === null ? null : (
                <p className="text-xs text-destructive-text">{addError}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="items-center border-t border-border-hairline bg-surface-raised px-6 py-3 sm:justify-between">
          <div className="flex items-center gap-2.5">
            <StepDots current={step} />
            <span className="text-xs text-subtle-foreground">
              {step === 0
                ? canContinue
                  ? ""
                  : nothingInstalled
                    ? "Install an agent to continue"
                    : "Sign in to at least one agent to continue"
                : selected.size > 0
                  ? `${selected.size} project${selected.size > 1 ? "s" : ""} selected`
                  : "You can add projects any time"}
            </span>
          </div>
          <div className="flex gap-2">
            {step === 0 ? (
              <>
                {canContinue ? null : (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onEvent?.({ name: "step_skipped", step: "agents" });
                      setStep(1);
                    }}
                  >
                    Skip for now
                  </Button>
                )}
                <Button
                  disabled={!canContinue}
                  onClick={() => {
                    onEvent?.({ name: "step_completed", step: "agents" });
                    setStep(1);
                  }}
                >
                  Continue
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button disabled={adding} onClick={() => void addProjects()}>
                  {adding
                    ? "Adding…"
                    : selected.size === 0
                      ? "Skip for now"
                      : "Add projects"}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Rendered inside the onboarding dialog's tree so it portals above it. */}
      <ProjectPathDialog
        hostId={pathPicker.hostId}
        hostName={pathPicker.hostName}
        pending={false}
        platform={pathPicker.platform}
        target={pathPicker.projectPathDialog.target}
        onOpenChange={pathPicker.projectPathDialog.onOpenChange}
        onSubmit={pathPicker.submitProjectPath}
      />
    </Dialog>
  );
}
