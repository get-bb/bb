import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  AgentSignInGuide,
  AgentStep,
  DevicesStep,
  OnboardingLayout,
  OnboardingPluginCard,
  OnboardingPluginGrid,
  OnboardingPluginGridSkeleton,
  ProjectsStep,
  type OnboardingAgent,
  type OnboardingConnectState,
  type OnboardingRepo,
} from "./OnboardingViews";
import {
  SetupChecklistBanner,
  type SetupChecklistItem,
} from "./SetupChecklistHost";
import type { AgentSetupState, OnboardingStepId } from "./onboarding-model";
import claudeLogoUrl from "../../../../../plugins/provider-claude-code/icons/claude-code.svg";
import codexLogoUrl from "../../../../../plugins/provider-codex/icons/codex.svg";
import piLogoUrl from "../../../../../plugins/provider-pi/icons/pi.svg";

export default {
  title: "onboarding/First run",
};

const noop = () => {};
const MACHINE_NAME = "Sawyer's MacBook Pro";
const CONNECT_URL = "https://sawyer.getbb.app";
const MOBILE_LINKS = {
  ios: "https://testflight.apple.com/join/example",
  android: "https://example.com/bb-android.apk",
};

type AgentId = "claude-code" | "codex" | "pi";
type AgentStates = Record<AgentId, AgentSetupState>;

const AGENT_BASE: readonly { id: AgentId; name: string; logoUrl: string }[] = [
  { id: "claude-code", name: "Claude Code", logoUrl: claudeLogoUrl },
  { id: "codex", name: "Codex", logoUrl: codexLogoUrl },
  { id: "pi", name: "Pi", logoUrl: piLogoUrl },
];

const CHECKING: AgentSetupState = { status: "checking" };
const INSTALL: AgentSetupState = { status: "install", canInstall: true };
const SIGNED_OUT: AgentSetupState = {
  status: "signIn",
  reason: "signedOut",
  canSignIn: true,
};
const CLAUDE_READY: AgentSetupState = {
  status: "ready",
  detail: "sawyer@acme.dev · Max (20x)",
};
const CODEX_READY: AgentSetupState = {
  status: "ready",
  detail: "sawyer@acme.dev · Pro",
};

function FakeTerminal({ command }: { command: string }) {
  return (
    <pre className="h-full overflow-hidden whitespace-pre-wrap p-3 font-mono text-xs text-foreground">
      <span className="text-muted-foreground">$ </span>
      {command}
    </pre>
  );
}

const CLAUDE_SIGN_IN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=example";
const CODEX_SIGN_IN_URL = "https://auth.openai.com/codex/device";

type SignInVariant = "starting" | "guided" | "terminal";

function StorySignInGuide({
  agentId,
  agentName,
  variant,
}: {
  agentId: AgentId;
  agentName: string;
  variant: SignInVariant;
}) {
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [terminalVisible, setTerminalVisible] = useState(
    variant === "terminal",
  );
  const codex = agentId === "codex";
  return (
    <AgentSignInGuide
      agentName={agentName}
      guide={
        variant === "starting"
          ? null
          : variant === "terminal"
            ? { url: null, userCode: null, acceptsPastedCode: false }
            : {
                url: codex ? CODEX_SIGN_IN_URL : CLAUDE_SIGN_IN_URL,
                userCode: codex ? "JWMS-GLRCB" : null,
                acceptsPastedCode: !codex,
              }
      }
      code={code}
      codeSubmitted={submitted}
      terminalVisible={terminalVisible}
      terminal={
        <FakeTerminal
          command={codex ? "codex login --device-auth" : "claude auth login"}
        />
      }
      onCodeChange={(next) => {
        setCode(next);
        setSubmitted(false);
      }}
      onSubmitCode={() => setSubmitted(true)}
      onOpenUrl={noop}
      onCopy={noop}
      onToggleTerminal={() => setTerminalVisible((visible) => !visible)}
      alternateLabel={codex ? "Use browser sign-in instead" : null}
      onUseAlternate={noop}
    />
  );
}

function buildAgents(
  states: AgentStates,
  signInVariant: SignInVariant = "guided",
): OnboardingAgent[] {
  return AGENT_BASE.map((agent) => ({
    id: agent.id,
    name: agent.name,
    provider: { id: agent.id, logoUrl: agent.logoUrl },
    state: states[agent.id],
    expanded:
      states[agent.id].status === "signingIn" ? (
        <StorySignInGuide
          agentId={agent.id}
          agentName={agent.name}
          variant={signInVariant}
        />
      ) : undefined,
  }));
}

function anyReady(states: AgentStates): boolean {
  return Object.values(states).some((state) => state.status === "ready");
}

const REPOS: readonly OnboardingRepo[] = [
  {
    id: "bb",
    name: "bb",
    path: "/Users/sawyer/projects/bb",
    lastActive: "12m ago",
    remote: "get-bb/bb",
    added: false,
  },
  {
    id: "acme-web",
    name: "acme-web",
    path: "/Users/sawyer/code/acme/web",
    lastActive: "3h ago",
    remote: "acme/web",
    added: false,
  },
  {
    id: "acme-api",
    name: "acme-api",
    path: "/Users/sawyer/code/acme/api",
    lastActive: "Yesterday",
    remote: "acme/api",
    added: true,
  },
  {
    id: "dotfiles",
    name: "dotfiles",
    path: "/Users/sawyer/dotfiles",
    lastActive: "4d ago",
    remote: "sawyerhood/dotfiles",
    added: false,
  },
  {
    id: "blog",
    name: "blog",
    path: "/Users/sawyer/code/blog",
    lastActive: "2w ago",
    remote: null,
    added: false,
  },
];
const DEFAULT_REPO_IDS = ["bb", "acme-web", "dotfiles"];

const PLUGINS: readonly {
  id: string;
  name: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "browser-automation",
    name: "Browser Automation",
    icon: "Globe",
    description:
      "Let BB control the in-app browser and browsers on connected machines, with inline previews for headless sessions.",
  },
  {
    id: "workflows",
    name: "Workflows",
    icon: "Workflow",
    description: "Run durable, provider-independent agent workflows.",
  },
  {
    id: "monaco-editor",
    name: "File Editor",
    icon: "Code",
    description:
      "Edit files in BB with the Monaco editor instead of the read-only preview.",
  },
  {
    id: "prompt-library",
    name: "Prompt Library",
    icon: "Clock",
    description:
      "Search previous prompts, star favorites, and insert them into the composer.",
  },
  {
    id: "agent-annotations",
    name: "Agent Annotations",
    icon: "MessageSquarePlus",
    description:
      "Select elements in a Browser tab, comment on them, and add them to the prompt.",
  },
  {
    id: "ask-user-question",
    name: "Ask User Question",
    icon: "MessageQuestion",
    description:
      "Let any provider ask the user a multiple-choice question, the way Claude Code's AskUserQuestion does natively.",
  },
];

function StoryWindow({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-lg"
      style={{ width: compact ? 390 : 960, height: 760, maxWidth: "100%" }}
    >
      {children}
    </div>
  );
}

function Captioned({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex max-w-[960px] flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </figcaption>
      {children}
    </figure>
  );
}

function Gallery({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10 p-6">{children}</div>;
}

interface StepChromeProps {
  compact?: boolean;
  onSelectStep?: (step: OnboardingStepId) => void;
  onSkipAll?: () => void;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onBack?: () => void;
}

function AgentFrame({
  states,
  machineName = MACHINE_NAME,
  loading = false,
  signInVariant = "guided",
  onSignIn = noop,
  onInstall = noop,
  onViewInstallLog = noop,
  onCancelSignIn = noop,
  onRecheck = noop,
  ...chrome
}: StepChromeProps & {
  states: AgentStates;
  machineName?: string | null;
  loading?: boolean;
  signInVariant?: SignInVariant;
  onSignIn?: (id: string) => void;
  onInstall?: (id: string) => void;
  onViewInstallLog?: (id: string) => void;
  onCancelSignIn?: (id: string) => void;
  onRecheck?: () => void;
}) {
  const ready = anyReady(states);
  return (
    <OnboardingLayout
      step="agent"
      compact={chrome.compact}
      title="Connect a coding agent"
      description="bb runs the agents you already use. You need one that is installed and signed in on this computer."
      footerNote={
        ready ? null : "Threads can't start until one agent is ready."
      }
      primaryLabel="Continue"
      primaryDisabled={!ready}
      secondaryLabel={ready ? undefined : "Skip for now"}
      onPrimary={chrome.onPrimary ?? noop}
      onSecondary={chrome.onSecondary ?? noop}
      onSelectStep={chrome.onSelectStep ?? noop}
      onSkipAll={chrome.onSkipAll ?? noop}
    >
      <AgentStep
        machineName={machineName}
        agents={loading ? null : buildAgents(states, signInVariant)}
        onSignIn={onSignIn}
        onInstall={onInstall}
        onViewInstallLog={onViewInstallLog}
        onCancelSignIn={onCancelSignIn}
        onRecheck={onRecheck}
      />
    </OnboardingLayout>
  );
}

function ProjectsFrame({
  status = { kind: "results", truncated: false },
  repos = REPOS,
  selectedIds = new Set(DEFAULT_REPO_IDS),
  importing = false,
  onToggle = noop,
  onSelectAll = noop,
  onSelectNone = noop,
  ...chrome
}: StepChromeProps & {
  status?: Parameters<typeof ProjectsStep>[0]["status"];
  repos?: readonly OnboardingRepo[];
  selectedIds?: ReadonlySet<string>;
  importing?: boolean;
  onToggle?: (id: string) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
}) {
  const scanning = status.kind === "scanning";
  return (
    <OnboardingLayout
      step="projects"
      compact={chrome.compact}
      title="Add your projects"
      description="Git repos on this computer that you've worked in over the last 30 days."
      primaryLabel={
        scanning || selectedIds.size === 0
          ? "Continue"
          : `Import ${selectedIds.size} projects`
      }
      primaryDisabled={scanning}
      primaryBusy={importing}
      secondaryLabel="Skip"
      onPrimary={chrome.onPrimary ?? noop}
      onSecondary={chrome.onSecondary ?? noop}
      onBack={chrome.onBack ?? noop}
      onSelectStep={chrome.onSelectStep ?? noop}
      onSkipAll={chrome.onSkipAll ?? noop}
    >
      <ProjectsStep
        status={status}
        repos={repos}
        selectedIds={selectedIds}
        onToggle={onToggle}
        onSelectAll={onSelectAll}
        onSelectNone={onSelectNone}
        onAddFolder={noop}
        onRetry={noop}
      />
    </OnboardingLayout>
  );
}

function PluginsFrame({
  enabledIds = new Set<string>(),
  pendingIds = new Set<string>(),
  loading = false,
  onToggle = noop,
  ...chrome
}: StepChromeProps & {
  enabledIds?: ReadonlySet<string>;
  pendingIds?: ReadonlySet<string>;
  loading?: boolean;
  onToggle?: (id: string, enabled: boolean) => void;
}) {
  return (
    <OnboardingLayout
      step="plugins"
      compact={chrome.compact}
      title="Make bb yours"
      description="Most of bb is plugins. These ones are off until you want them, and you can change your mind in Plugins."
      primaryLabel="Continue"
      secondaryLabel="Skip"
      onPrimary={chrome.onPrimary ?? noop}
      onSecondary={chrome.onSecondary ?? noop}
      onBack={chrome.onBack ?? noop}
      onSelectStep={chrome.onSelectStep ?? noop}
      onSkipAll={chrome.onSkipAll ?? noop}
    >
      <OnboardingPluginGrid compact={chrome.compact}>
        {loading ? (
          <OnboardingPluginGridSkeleton count={PLUGINS.length} />
        ) : (
          PLUGINS.map((plugin) => (
            <OnboardingPluginCard
              key={plugin.id}
              name={plugin.name}
              description={plugin.description}
              icon={{ icon: plugin.icon, iconUrl: null, iconTinted: false }}
              enabled={enabledIds.has(plugin.id)}
              pending={pendingIds.has(plugin.id)}
              unavailableReason={null}
              onToggle={(enabled) => onToggle(plugin.id, enabled)}
            />
          ))
        )}
      </OnboardingPluginGrid>
    </OnboardingLayout>
  );
}

function DevicesFrame({
  connect = { status: "off" },
  connectSetupOpen = false,
  otherMachineCount = 0,
  onToggleConnectSetup = noop,
  ...chrome
}: StepChromeProps & {
  connect?: OnboardingConnectState;
  connectSetupOpen?: boolean;
  otherMachineCount?: number;
  onToggleConnectSetup?: () => void;
}) {
  return (
    <OnboardingLayout
      step="devices"
      compact={chrome.compact}
      title="Use bb from anywhere"
      description="All optional. Everything here also lives in Settings → Machines."
      primaryLabel="Start using bb"
      onPrimary={chrome.onPrimary ?? noop}
      onBack={chrome.onBack ?? noop}
      onSelectStep={chrome.onSelectStep ?? noop}
      onSkipAll={chrome.onSkipAll ?? noop}
    >
      <DevicesStep
        connect={connect}
        connectSetup={
          <p className="text-xs text-muted-foreground">
            The bb connect plugin's own settings render here: sign in to your bb
            account, then turn on remote access.
          </p>
        }
        connectSetupOpen={connectSetupOpen}
        otherMachineCount={otherMachineCount}
        mobileLinks={MOBILE_LINKS}
        onToggleConnectSetup={onToggleConnectSetup}
        onCopyConnectUrl={noop}
        onAddMachine={noop}
      />
    </OnboardingLayout>
  );
}

function checklistItems(done: {
  agent: boolean;
  projects: boolean;
  plugins: boolean;
  devices: boolean;
}): SetupChecklistItem[] {
  return [
    {
      id: "agent",
      title: "Connect a coding agent",
      detail: done.agent
        ? "Ready on this computer"
        : "Needed before a thread can start",
      done: done.agent,
      actionLabel: "Set up",
    },
    {
      id: "projects",
      title: "Add your projects",
      detail: done.projects
        ? "3 added"
        : "Import the repos you've used recently",
      done: done.projects,
      actionLabel: "Review",
    },
    {
      id: "plugins",
      title: "Pick some plugins",
      detail: done.plugins
        ? "2 turned on"
        : "Browser automation, workflows, and more",
      done: done.plugins,
      actionLabel: "Browse",
    },
    {
      id: "devices",
      title: "Use bb from anywhere",
      detail: done.devices ? CONNECT_URL : "Phone, browser, other machines",
      done: done.devices,
      actionLabel: "Set up",
    },
  ];
}

function HomeFrame({
  items,
  agentMissing,
  onOpen = noop,
  onDismiss = noop,
}: {
  items: SetupChecklistItem[] | null;
  agentMissing: boolean;
  onOpen?: (step: OnboardingStepId) => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-6 pt-14">
      <SetupChecklistBanner
        checklist={{ items, agentMissing, open: onOpen, dismiss: onDismiss }}
      />
      <p className="rounded-lg border border-border px-3 py-6 text-sm text-muted-foreground">
        The usual bb home composer goes here.
      </p>
    </div>
  );
}

type Scenario = "ready" | "signedOut" | "nothing";

const SCENARIOS: readonly { id: Scenario; label: string }[] = [
  { id: "ready", label: "Already signed in" },
  { id: "signedOut", label: "Installed, signed out" },
  { id: "nothing", label: "Nothing installed" },
];

function scenarioStates(scenario: Scenario): AgentStates {
  switch (scenario) {
    case "ready":
      return { "claude-code": CLAUDE_READY, codex: SIGNED_OUT, pi: INSTALL };
    case "signedOut":
      return { "claude-code": SIGNED_OUT, codex: INSTALL, pi: INSTALL };
    case "nothing":
      return { "claude-code": INSTALL, codex: INSTALL, pi: INSTALL };
  }
}

function isAgentId(id: string): id is AgentId {
  return id === "claude-code" || id === "codex" || id === "pi";
}

function InteractiveFlowRun({ scenario }: { scenario: Scenario }) {
  const [view, setView] = useState<OnboardingStepId | "home">("agent");
  const [agentStates, setAgentStates] = useState<AgentStates | null>(null);
  const [scanning, setScanning] = useState(true);
  const [selectedRepoIds, setSelectedRepoIds] = useState<ReadonlySet<string>>(
    () => new Set(DEFAULT_REPO_IDS),
  );
  const [imported, setImported] = useState(false);
  const [enabledPluginIds, setEnabledPluginIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [connectSetupOpen, setConnectSetupOpen] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const timers = useRef<number[]>([]);

  const later = (delayMs: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, delayMs));
  };

  useEffect(() => {
    const pending = timers.current;
    pending.push(
      window.setTimeout(() => setAgentStates(scenarioStates(scenario)), 700),
      window.setTimeout(() => setScanning(false), 1500),
    );
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
    };
  }, [scenario]);

  const setAgent = (id: string, state: AgentSetupState) => {
    if (!isAgentId(id)) return;
    setAgentStates((current) =>
      current === null ? current : { ...current, [id]: state },
    );
  };
  const resolveAgent = (
    id: string,
    from: AgentSetupState["status"],
    to: AgentSetupState,
  ) => {
    if (!isAgentId(id)) return;
    setAgentStates((current) =>
      current !== null && current[id].status === from
        ? { ...current, [id]: to }
        : current,
    );
  };

  const chrome = {
    onSelectStep: setView,
    onSkipAll: () => setView("home"),
  };
  const states = agentStates ?? {
    "claude-code": CHECKING,
    codex: CHECKING,
    pi: CHECKING,
  };

  if (view === "home") {
    const items = checklistItems({
      agent: anyReady(states),
      projects: imported,
      plugins: enabledPluginIds.size > 0,
      devices: false,
    });
    return (
      <StoryWindow>
        <HomeFrame
          items={checklistDismissed ? null : items}
          agentMissing={!anyReady(states)}
          onOpen={setView}
          onDismiss={() => setChecklistDismissed(true)}
        />
      </StoryWindow>
    );
  }

  return (
    <StoryWindow>
      {view === "agent" ? (
        <AgentFrame
          {...chrome}
          states={states}
          loading={agentStates === null}
          onPrimary={() => setView("projects")}
          onSecondary={() => setView("projects")}
          onSignIn={(id) => {
            setAgent(id, { status: "signingIn" });
            later(2400, () =>
              resolveAgent(
                id,
                "signingIn",
                id === "codex" ? CODEX_READY : CLAUDE_READY,
              ),
            );
          }}
          onInstall={(id) => {
            setAgent(id, { status: "installing" });
            later(1800, () => resolveAgent(id, "installing", SIGNED_OUT));
          }}
          onCancelSignIn={(id) => setAgent(id, SIGNED_OUT)}
        />
      ) : null}
      {view === "projects" ? (
        <ProjectsFrame
          {...chrome}
          status={
            scanning
              ? { kind: "scanning" }
              : { kind: "results", truncated: false }
          }
          selectedIds={selectedRepoIds}
          onToggle={(id) =>
            setSelectedRepoIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onSelectAll={() =>
            setSelectedRepoIds(
              new Set(
                REPOS.filter((repo) => !repo.added).map((repo) => repo.id),
              ),
            )
          }
          onSelectNone={() => setSelectedRepoIds(new Set())}
          onPrimary={() => {
            setImported(selectedRepoIds.size > 0);
            setView("plugins");
          }}
          onSecondary={() => setView("plugins")}
          onBack={() => setView("agent")}
        />
      ) : null}
      {view === "plugins" ? (
        <PluginsFrame
          {...chrome}
          enabledIds={enabledPluginIds}
          onToggle={(id, enabled) =>
            setEnabledPluginIds((current) => {
              const next = new Set(current);
              if (enabled) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onPrimary={() => setView("devices")}
          onSecondary={() => setView("devices")}
          onBack={() => setView("projects")}
        />
      ) : null}
      {view === "devices" ? (
        <DevicesFrame
          {...chrome}
          connectSetupOpen={connectSetupOpen}
          onToggleConnectSetup={() => setConnectSetupOpen((open) => !open)}
          onPrimary={() => setView("home")}
          onBack={() => setView("plugins")}
        />
      ) : null}
    </StoryWindow>
  );
}

export function InteractiveFlow() {
  const [scenario, setScenario] = useState<Scenario>("signedOut");
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>This computer starts with:</span>
        {SCENARIOS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setScenario(entry.id);
              setRun((current) => current + 1);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1",
              entry.id === scenario
                ? "border-foreground text-foreground"
                : "border-border hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRun((current) => current + 1)}
        >
          Restart
        </Button>
      </div>
      <InteractiveFlowRun key={`${scenario}:${run}`} scenario={scenario} />
    </div>
  );
}

export function Step1AgentStates() {
  return (
    <Gallery>
      <Captioned
        label="An agent is already signed in"
        hint="The common case: Continue is the only action."
      >
        <StoryWindow>
          <AgentFrame
            states={{
              "claude-code": CLAUDE_READY,
              codex: SIGNED_OUT,
              pi: INSTALL,
            }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Waiting for the machine, then loading"
        hint="No machine yet shows a waiting line; a connected machine shows skeleton rows until health answers."
      >
        <StoryWindow>
          <AgentFrame
            loading
            machineName={null}
            states={{ "claude-code": CHECKING, codex: CHECKING, pi: CHECKING }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Signing in with a pasted code (Claude Code)"
        hint="The login command runs in a hidden terminal; bb lifts the sign-in link out of its output and types the pasted code back in."
      >
        <StoryWindow>
          <AgentFrame
            states={{
              "claude-code": { status: "signingIn" },
              codex: { status: "signIn", reason: "expired", canSignIn: true },
              pi: INSTALL,
            }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Signing in with a device code (Codex)"
        hint="The code and link come from the login command's output; the CLI finishes on its own once the code is entered."
      >
        <StoryWindow>
          <AgentFrame
            states={{
              "claude-code": {
                status: "signIn",
                reason: "failed",
                canSignIn: true,
              },
              codex: { status: "signingIn" },
              pi: INSTALL,
            }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Sign-in starting, and the terminal fallback"
        hint="If no link shows up within a few seconds, or on request, the raw terminal is shown so any agent's login still works."
      >
        <StoryWindow>
          <AgentFrame
            signInVariant="starting"
            states={{
              "claude-code": { status: "signingIn" },
              codex: SIGNED_OUT,
              pi: INSTALL,
            }}
          />
        </StoryWindow>
        <StoryWindow>
          <AgentFrame
            signInVariant="terminal"
            states={{
              "claude-code": SIGNED_OUT,
              codex: SIGNED_OUT,
              pi: { status: "signingIn" },
            }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Installing, failed, update needed, unknown"
        hint="Install and Update reuse the provider CLI install action. A failed install offers its log. Unknown health never blocks or nags."
      >
        <StoryWindow>
          <AgentFrame
            states={{
              "claude-code": { status: "installing" },
              codex: {
                status: "installFailed",
                message: "Install failed",
                canInstall: true,
              },
              pi: {
                status: "update",
                detail: "Needs version 0.84.0 or newer",
                canInstall: true,
              },
            }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Phone width"
        hint="Step labels collapse to the active one."
      >
        <StoryWindow compact>
          <AgentFrame
            compact
            states={{
              "claude-code": CLAUDE_READY,
              codex: SIGNED_OUT,
              pi: { status: "unknown", message: "Machine is paused." },
            }}
          />
        </StoryWindow>
      </Captioned>
    </Gallery>
  );
}

export function Step2ProjectStates() {
  return (
    <Gallery>
      <Captioned
        label="Recent repos found"
        hint="Repos touched in the last week are preselected; repos that are already projects are checked and locked."
      >
        <StoryWindow>
          <ProjectsFrame />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Scanning"
        hint="The scan starts as soon as setup opens."
      >
        <StoryWindow>
          <ProjectsFrame status={{ kind: "scanning" }} />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Importing, with a truncated scan"
        hint="Projects are created one at a time; the note appears when the walk ran out of time."
      >
        <StoryWindow>
          <ProjectsFrame
            importing
            status={{ kind: "results", truncated: true }}
          />
        </StoryWindow>
      </Captioned>
      <Captioned label="Nothing found" hint="Falls back to the folder picker.">
        <StoryWindow>
          <ProjectsFrame repos={[]} selectedIds={new Set()} />
        </StoryWindow>
      </Captioned>
      <Captioned label="Scan failed" hint="Retry, or pick a folder by hand.">
        <StoryWindow>
          <ProjectsFrame
            repos={[]}
            selectedIds={new Set()}
            status={{
              kind: "error",
              message: "bb couldn't scan this computer for git repos.",
            }}
          />
        </StoryWindow>
      </Captioned>
    </Gallery>
  );
}

export function Step3Plugins() {
  return (
    <Gallery>
      <Captioned
        label="Built-in plugins that are off by default"
        hint="Names, icons and descriptions come from the bb-official catalog."
      >
        <StoryWindow>
          <PluginsFrame />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Two on, one installing"
        hint="Browser Automation is installed from the catalog; the others are enabled in place."
      >
        <StoryWindow>
          <PluginsFrame
            enabledIds={new Set(["workflows", "prompt-library"])}
            pendingIds={new Set(["browser-automation"])}
          />
        </StoryWindow>
      </Captioned>
      <Captioned label="Loading" hint="Before the catalog answers.">
        <StoryWindow>
          <PluginsFrame loading />
        </StoryWindow>
      </Captioned>
    </Gallery>
  );
}

export function Step4Devices() {
  return (
    <Gallery>
      <Captioned label="Default" hint="Three optional rows.">
        <StoryWindow>
          <DevicesFrame />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Setting up bb connect"
        hint="The connect plugin's settings section is embedded in the row."
      >
        <StoryWindow>
          <DevicesFrame connectSetupOpen />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="bb connect on, another machine already connected"
        hint="The address is copyable; Add machine opens the existing dialog."
      >
        <StoryWindow>
          <DevicesFrame
            connect={{ status: "on", url: CONNECT_URL }}
            otherMachineCount={1}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="bb connect plugin disabled"
        hint="No action is offered when the plugin is off."
      >
        <StoryWindow>
          <DevicesFrame connect={{ status: "unavailable" }} />
        </StoryWindow>
      </Captioned>
    </Gallery>
  );
}

export function HomeAfterSkipping() {
  return (
    <Gallery>
      <Captioned
        label="Home after Skip setup, no agent ready"
        hint="The home composer leads with the missing agent. Dismissing the checklist also stops this notice."
      >
        <StoryWindow>
          <HomeFrame
            agentMissing
            items={checklistItems({
              agent: false,
              projects: true,
              plugins: false,
              devices: false,
            })}
          />
        </StoryWindow>
      </Captioned>
      <Captioned
        label="Home with an agent ready and steps left"
        hint="A one-line checklist names the next open step; Continue reopens the guide there."
      >
        <StoryWindow>
          <HomeFrame
            agentMissing={false}
            items={checklistItems({
              agent: true,
              projects: true,
              plugins: false,
              devices: false,
            })}
          />
        </StoryWindow>
      </Captioned>
    </Gallery>
  );
}
