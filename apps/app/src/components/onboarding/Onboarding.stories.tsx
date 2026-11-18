import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { SystemProviderState } from "@bb/server-contract";
import {
  AgentInstallErrorDetails,
  AgentSignInInstruction,
  AgentSignInPanel,
  AgentStep,
  DevicesStep,
  OnboardingLayout,
  OnboardingPluginCard,
  OnboardingPluginGrid,
  ProjectsStep,
  type OnboardingAgent,
  type OnboardingRepo,
} from "./OnboardingViews";
import {
  STEP_COPY,
  agentCheckFailedMessage,
  agentListFailedMessage,
  agentSignInView,
  resolveAgentSetupState,
  type AgentSetupState,
} from "./onboarding-model";
import claudeLogoUrl from "../../../../../plugins/provider-claude-code/icons/claude-code.svg";
import codexLogoUrl from "../../../../../plugins/provider-codex/icons/codex.svg";
import piLogoUrl from "../../../../../plugins/provider-pi/icons/pi.svg";
import grokLogoUrl from "../../../../../plugins/provider-acp/icons/grok.svg";

export default {
  title: "onboarding/First run",
};

const noop = () => {};
const MACHINE_NAME = "Sawyer's MacBook Pro";

type AgentId = "claude-code" | "codex" | "pi";

const AGENT_BASE: readonly { id: AgentId; name: string; logoUrl: string }[] = [
  { id: "claude-code", name: "Claude Code", logoUrl: claudeLogoUrl },
  { id: "codex", name: "Codex", logoUrl: codexLogoUrl },
  { id: "pi", name: "Pi", logoUrl: piLogoUrl },
];

const INSTALL: AgentSetupState = { status: "install", canInstall: true };
const SIGNED_OUT: AgentSetupState = {
  status: "signIn",
  reason: "signedOut",
  canSignIn: true,
};

function FakeTerminal({
  command,
  output,
}: {
  command: string;
  output?: string;
}) {
  return (
    <pre className="h-full overflow-hidden whitespace-pre-wrap p-3 font-mono text-xs text-foreground">
      <span className="text-muted-foreground">$ </span>
      {command}
      {output === undefined ? null : `\n${output}`}
    </pre>
  );
}

const CLAUDE_SIGN_IN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=example";
const CODEX_SIGN_IN_URL = "https://auth.openai.com/codex/device";

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

type SignInStory = "claude-code" | "codex" | "codex-browser";

const CODEX_BROWSER_SIGN_IN_URL =
  "https://auth.openai.com/oauth/authorize?response_type=code&client_id=example&state=example";

function signInView(story: SignInStory) {
  return {
    guide:
      story === "codex"
        ? {
            url: CODEX_SIGN_IN_URL,
            userCode: "JWMS-GLRCB",
            acceptsPastedCode: false,
          }
        : story === "codex-browser"
          ? {
              url: CODEX_BROWSER_SIGN_IN_URL,
              userCode: null,
              acceptsPastedCode: false,
            }
          : {
              url: CLAUDE_SIGN_IN_URL,
              userCode: null,
              acceptsPastedCode: true,
            },
    terminalVisible: false,
    started: true,
  };
}

function SignInPanelStory({ story }: { story: SignInStory }) {
  const [code, setCode] = useState("");
  const codex = story !== "claude-code";
  return (
    <AgentSignInPanel
      connect={false}
      agentName={codex ? "Codex" : "Claude Code"}
      view={signInView(story)}
      code={code}
      codeSubmitted={false}
      terminal={
        <FakeTerminal
          command={
            story === "codex"
              ? "codex login --device-auth"
              : codex
                ? "codex login"
                : "claude auth login"
          }
        />
      }
      onCodeChange={setCode}
      onSubmitCode={noop}
      onCopy={noop}
      onToggleTerminal={noop}
    />
  );
}

type PiStage = "signingIn" | "failed";

const PI_LOGIN_MENU = [
  "> /login",
  "Select provider to login:",
  "> Anthropic (Claude Pro/Max)",
  "  GitHub Copilot",
  "  Google Cloud Code Assist (Gemini CLI)",
  "  OpenAI (ChatGPT Plus/Pro)",
].join("\n");

function PiSignInPanelStory() {
  return (
    <AgentSignInPanel
      connect
      agentName="Pi"
      view={{ guide: null, terminalVisible: true, started: true }}
      code=""
      codeSubmitted={false}
      terminal={<FakeTerminal command="pi" output={PI_LOGIN_MENU} />}
      onCodeChange={noop}
      onSubmitCode={noop}
      onCopy={noop}
      onToggleTerminal={noop}
    />
  );
}

const GROK_LOGIN_OUTPUT = [
  "Opening your browser to sign in to xAI…",
  "If it didn't open, visit https://accounts.x.ai/device",
  "and enter code: WDJB-MJHT",
  "Waiting for authorization…",
].join("\n");

function grokSigningInAgent(): OnboardingAgent {
  const view = agentSignInView({
    parsed: false,
    connect: false,
    outputText: GROK_LOGIN_OUTPUT,
    fallbackDue: false,
    terminalChoice: null,
  });
  return {
    id: "acp-grok",
    name: "Grok Build",
    provider: { id: "acp-grok", logoUrl: grokLogoUrl },
    setup: "signIn",
    state: { status: "signingIn" },
    subline: (
      <AgentSignInInstruction
        agentName="Grok Build"
        view={view}
        onOpenUrl={noop}
      />
    ),
    expanded: (
      <AgentSignInPanel
        connect={false}
        agentName="Grok Build"
        view={view}
        code=""
        codeSubmitted={false}
        terminal={
          <FakeTerminal command="grok login" output={GROK_LOGIN_OUTPUT} />
        }
        onCodeChange={noop}
        onSubmitCode={noop}
        onCopy={noop}
        onToggleTerminal={noop}
      />
    ),
  };
}

function AgentFrame({
  signingIn,
  pi = null,
  installError = false,
  states = {},
  expanded = {},
  extraAgents = [],
  loadFailed = null,
}: {
  signingIn: SignInStory | null;
  pi?: PiStage | null;
  installError?: boolean;
  states?: Partial<Record<AgentId, AgentSetupState>>;
  expanded?: Partial<Record<AgentId, ReactNode>>;
  extraAgents?: readonly OnboardingAgent[];
  loadFailed?: { message: string; retrying: boolean } | null;
}) {
  const signInAgentId = signingIn === "codex-browser" ? "codex" : signingIn;
  const baseAgents: OnboardingAgent[] = AGENT_BASE.map((agent) => {
    const signingInHere = signingIn !== null && agent.id === signInAgentId;
    const state: AgentSetupState =
      states[agent.id] ??
      (signingInHere
        ? { status: "signingIn" }
        : installError && agent.id === "claude-code"
          ? {
              status: "installFailed",
              message: "Couldn't install. Check your connection and retry.",
              canInstall: true,
            }
          : agent.id === "pi"
            ? pi === null
              ? INSTALL
              : pi === "failed"
                ? { status: "signIn", reason: "failed", canSignIn: true }
                : { status: "signingIn" }
            : SIGNED_OUT);
    return {
      id: agent.id,
      name: agent.name,
      provider: { id: agent.id, logoUrl: agent.logoUrl },
      setup: agent.id === "pi" ? "connect" : "signIn",
      state,
      subline:
        signingInHere && signingIn !== null ? (
          <AgentSignInInstruction
            agentName={agent.name}
            view={signInView(signingIn)}
            onOpenUrl={noop}
          />
        ) : undefined,
      expanded:
        expanded[agent.id] ??
        (signingInHere && signingIn !== null ? (
          <SignInPanelStory story={signingIn} />
        ) : agent.id === "pi" && pi === "signingIn" ? (
          <PiSignInPanelStory />
        ) : state.status === "installFailed" ? (
          <AgentInstallErrorDetails
            log={
              "npm ERR! code ECONNRESET\nnpm ERR! network request to https://registry.npmjs.org failed"
            }
          />
        ) : undefined),
    };
  });
  const agents = [...baseAgents, ...extraAgents];
  return (
    <TooltipProvider>
      <OnboardingLayout
        step="agent"
        {...STEP_COPY.agent}
        onPrimary={noop}
        onSelectStep={noop}
      >
        <AgentStep
          machineName={MACHINE_NAME}
          agents={loadFailed === null ? agents : null}
          loadFailed={loadFailed}
          onSignIn={noop}
          onInstall={noop}
          onCancelSignIn={noop}
          onRetryCheck={noop}
          onRecheck={noop}
        />
      </OnboardingLayout>
    </TooltipProvider>
  );
}

export function AgentClaudeSignIn() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn="claude-code" />
    </div>
  );
}

export function AgentCodexSignIn() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn="codex" />
    </div>
  );
}

export function AgentCodexBrowserSignIn() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn="codex-browser" />
    </div>
  );
}

export function AgentPiSignIn() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn={null} pi="signingIn" />
    </div>
  );
}

export function AgentGrokSignIn() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn={null} extraAgents={[grokSigningInAgent()]} />
    </div>
  );
}

export function AgentPiSignInFailed() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn={null} pi="failed" />
    </div>
  );
}

function storyHealth(
  id: AgentId,
  status: SystemProviderState["status"],
): SystemProviderState {
  const agent = AGENT_BASE.find((candidate) => candidate.id === id);
  return {
    providerId: id,
    displayName: agent?.name ?? id,
    status,
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: true,
    canUpdate: true,
    loginCommand: null,
    localLoginCommand: null,
    internal_DO_NOT_USE_guidedSignIn: false,
    internal_DO_NOT_USE_setupGuidePlanLabel: null,
  };
}

export function AgentSignInJustClicked() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame
        signingIn={null}
        states={{ "claude-code": { status: "signingIn" } }}
        expanded={{
          "claude-code": (
            <AgentSignInPanel
              connect={false}
              agentName="Claude Code"
              view={{ guide: null, terminalVisible: false, started: false }}
              code=""
              codeSubmitted={false}
              terminal={null}
              onCodeChange={noop}
              onSubmitCode={noop}
              onCopy={noop}
              onToggleTerminal={noop}
            />
          ),
        }}
      />
    </div>
  );
}

export function AgentJustOpened() {
  const pending = {
    cliStatus: undefined,
    installing: false,
    installFailure: null,
    signingIn: false,
    signInFailed: false,
    installInfoPending: true,
  };
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame
        signingIn={null}
        states={{
          "claude-code": resolveAgentSetupState({
            ...pending,
            health: storyHealth("claude-code", "not_installed"),
          }),
          codex: resolveAgentSetupState({
            ...pending,
            health: {
              ...storyHealth("codex", "unsupported_version"),
              minimumSupportedVersion: "0.50.0",
            },
          }),
          pi: resolveAgentSetupState({
            ...pending,
            health: storyHealth("pi", "not_installed"),
          }),
        }}
      />
    </div>
  );
}

export function AgentInstallError() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame signingIn={null} installError />
    </div>
  );
}

export function PluginJustTurnedOn() {
  return (
    <div className="flex h-screen flex-col">
      <TooltipProvider>
        <OnboardingLayout
          step="plugins"
          width="wide"
          {...STEP_COPY.plugins}
          onPrimary={noop}
          onBack={noop}
          onSelectStep={noop}
        >
          <OnboardingPluginGrid compact={false}>
            {PLUGINS.map((plugin) => (
              <OnboardingPluginCard
                key={plugin.id}
                name={plugin.name}
                description={plugin.description}
                icon={{ icon: plugin.icon, iconUrl: null, iconTinted: false }}
                enabled={plugin.id === "browser-automation"}
                unavailableReason={null}
                onToggle={noop}
              />
            ))}
          </OnboardingPluginGrid>
        </OnboardingLayout>
      </TooltipProvider>
    </div>
  );
}

export function Projects() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(DEFAULT_REPO_IDS),
  );
  const selectable = REPOS.filter((repo) => !repo.added).map((repo) => repo.id);
  return (
    <div className="flex h-screen flex-col">
      <OnboardingLayout
        step="projects"
        skippedSteps={new Set()}
        title={STEP_COPY.projects.title}
        description={STEP_COPY.projects.description}
        primaryLabel={
          selected.size === 0
            ? STEP_COPY.projects.primaryLabel
            : `Import ${selected.size} projects`
        }
        onPrimary={noop}
        onBack={noop}
        onSelectStep={noop}
      >
        <ProjectsStep
          status={{ kind: "results", truncated: false }}
          repos={REPOS}
          selectedIds={selected}
          onToggle={(id) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onSelectAll={() => setSelected(new Set(selectable))}
          onSelectNone={() => setSelected(new Set())}
          onAddFolder={noop}
          onRetry={noop}
        />
      </OnboardingLayout>
    </div>
  );
}

export function Devices() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex h-screen flex-col">
      <TooltipProvider>
        <OnboardingLayout
          step="devices"
          width="wide"
          skippedSteps={new Set()}
          {...STEP_COPY.devices}
          onPrimary={noop}
          onBack={noop}
          onSelectStep={noop}
        >
          <DevicesStep
            hostName={MACHINE_NAME}
            showMachines
            connectSection={null}
            addMachinePanel={
              adding ? (
                <FakeTerminal command="curl -fsSL https://getbb.app/install | sh" />
              ) : null
            }
            onAddMachine={() => setAdding(true)}
            onCloseAddMachine={() => setAdding(false)}
          />
        </OnboardingLayout>
      </TooltipProvider>
    </div>
  );
}

export function AgentOneCheckTimedOut() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame
        signingIn={null}
        states={{
          "claude-code": { status: "ready", detail: null },
          codex: {
            status: "checkFailed",
            message: agentCheckFailedMessage("timed_out"),
            detail: null,
            retrying: false,
          },
        }}
      />
    </div>
  );
}

export function AgentAllChecksFailed() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame
        signingIn={null}
        loadFailed={{
          message: agentListFailedMessage({
            failure: "other",
            machineName: MACHINE_NAME,
          }),
          retrying: false,
        }}
      />
    </div>
  );
}

export function AgentMachineUnreachable() {
  return (
    <div className="flex h-screen flex-col">
      <AgentFrame
        signingIn={null}
        loadFailed={{
          message: agentListFailedMessage({
            failure: "host_unavailable",
            machineName: MACHINE_NAME,
          }),
          retrying: false,
        }}
      />
    </div>
  );
}
