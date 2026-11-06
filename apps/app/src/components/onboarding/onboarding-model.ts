import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import { BbRequestTimeoutError } from "@bb/sdk/browser";
import { asHttpError } from "@/lib/http-error";
import { viewerIsOnThisComputer } from "@/lib/local-host-daemon-access";
import type {
  HostDiscoveredRepo,
  RecordTelemetryEventRequest,
  ServerAccessStatus,
  SetupGuideVariant,
  SystemProviderState,
  SystemSetupGuideResponse,
} from "@bb/server-contract";

export type OnboardingStepId = "agent" | "projects" | "plugins" | "devices";

export const ONBOARDING_STEPS: readonly {
  id: OnboardingStepId;
  label: string;
}[] = [
  { id: "agent", label: "Agent" },
  { id: "projects", label: "Projects" },
  { id: "plugins", label: "Plugins" },
  { id: "devices", label: "Devices" },
];

export const ONBOARDING_PLUGIN_MARKETPLACE = "bb-official";

export const ONBOARDING_PLUGIN_ENTRY_IDS: readonly string[] = [
  "browser-automation",
  "workflows",
  "monaco-editor",
  "prompt-library",
  "agent-annotations",
  "ask-user-question",
];

export const CONNECT_PLUGIN_ID = "connect";

export interface TerminalConnectFlow {
  input: string;
  failure: RegExp;
}

const TERMINAL_CONNECT_FLOWS: Readonly<Record<string, TerminalConnectFlow>> = {
  pi: { input: "/login\r", failure: /Error: Failed to login to /u },
};

export function terminalConnectFlow(
  providerId: string,
): TerminalConnectFlow | null {
  return TERMINAL_CONNECT_FLOWS[providerId] ?? null;
}

export function agentRowSetup({
  connect,
  awaitingSession,
}: {
  connect: boolean;
  awaitingSession: boolean;
}): "signIn" | "connect" {
  return connect && !awaitingSession ? "connect" : "signIn";
}

export type SetupGuide = SystemSetupGuideResponse;

interface StepCopy {
  title: string;
  description: string;
  primaryLabel: string;
}

export const STEP_COPY: Readonly<
  Record<SetupGuideVariant, Readonly<Record<OnboardingStepId, StepCopy>>>
> = {
  control: {
    agent: {
      title: "Connect a coding agent",
      description:
        "bb runs the agents you already use. You need one that is installed and signed in on this computer.",
      primaryLabel: "Continue",
    },
    projects: {
      title: "Add your projects",
      description:
        "Git repos on this computer that you've worked in over the last 30 days.",
      primaryLabel: "Continue",
    },
    plugins: {
      title: "Make bb yours",
      description:
        "Most of bb is plugins. These ones are off until you want them, and you can change your mind in Plugins.",
      primaryLabel: "Continue",
    },
    devices: {
      title: "Use bb from anywhere",
      description:
        "All optional. Everything here also lives in Settings → Machines.",
      primaryLabel: "Start using bb",
    },
  },
  new: {
    agent: {
      title: "Connect a coding agent",
      description:
        "Agents run on your machine. bb needs one installed and signed in.",
      primaryLabel: "Continue",
    },
    projects: {
      title: "Add your projects",
      description: "Choose local Git repos used in the last 30 days.",
      primaryLabel: "Continue",
    },
    plugins: {
      title: "Make bb yours",
      description:
        "Customize almost everything in bb with plugins. Turn on a few, change them anytime.",
      primaryLabel: "Continue",
    },
    devices: {
      title: "Use bb away from this computer",
      description:
        "Start a task at your desk, then check on it from anywhere. Change these later in Settings.",
      primaryLabel: "Start using bb",
    },
  },
};

export type StepOutcome = "completed" | "skipped";

export function skippedStepIds(
  outcomes: ReadonlyMap<OnboardingStepId, StepOutcome>,
): ReadonlySet<OnboardingStepId> {
  return new Set(
    [...outcomes]
      .filter(([, outcome]) => outcome === "skipped")
      .map(([step]) => step),
  );
}

export type AgentSetupState =
  | { status: "checking" }
  | { status: "ready"; detail: string | null }
  | {
      status: "signIn";
      reason: "signedOut" | "expired" | "failed";
      canSignIn: boolean;
    }
  | { status: "signingIn" }
  | { status: "install"; canInstall: boolean }
  | { status: "update"; detail: string | null; canInstall: boolean }
  | { status: "installing"; update: boolean }
  | { status: "installFailed"; message: string; canInstall: boolean }
  | { status: "unknown"; message: string | null };

interface ResolveAgentSetupStateArgs {
  health: SystemProviderState;
  cliStatus: ProviderCliStatus | undefined;
  installing: boolean;
  installFailure: string | null;
  signingIn: boolean;
  signInFailed: boolean;
  installInfoPending: boolean;
  whileInstallInfoPending: "checking" | "offerInstall";
}

export function setupGuidePlanHealth(
  health: SystemProviderState,
): SystemProviderState {
  return {
    ...health,
    planLabel:
      health.internal_DO_NOT_USE_setupGuidePlanLabel ?? health.planLabel,
  };
}

export function resolveAgentSetupState({
  health,
  cliStatus,
  installing,
  installFailure,
  signingIn,
  signInFailed,
  installInfoPending,
  whileInstallInfoPending,
}: ResolveAgentSetupStateArgs): AgentSetupState {
  if (health.status === "ready") {
    const detail = [health.accountEmail, health.planLabel]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");
    return { status: "ready", detail: detail === "" ? null : detail };
  }
  if (installing) {
    return {
      status: "installing",
      update: health.status === "unsupported_version",
    };
  }
  const awaitingInstallInfo = cliStatus === undefined && installInfoPending;
  const canInstall =
    (awaitingInstallInfo && whileInstallInfoPending === "offerInstall") ||
    (cliStatus?.installAction !== null &&
      cliStatus?.installAction !== undefined);
  if (installFailure !== null) {
    return { status: "installFailed", message: installFailure, canInstall };
  }
  const checking =
    awaitingInstallInfo && whileInstallInfoPending === "checking";
  switch (health.status) {
    case "not_installed":
      return checking
        ? { status: "checking" }
        : { status: "install", canInstall };
    case "unsupported_version":
      if (checking) return { status: "checking" };
      return {
        status: "update",
        detail:
          health.minimumSupportedVersion === null
            ? health.statusMessage
            : `Needs version ${health.minimumSupportedVersion} or newer`,
        canInstall,
      };
    case "unauthenticated":
    case "expired":
      if (signingIn) return { status: "signingIn" };
      return {
        status: "signIn",
        reason: signInFailed
          ? "failed"
          : health.status === "expired"
            ? "expired"
            : "signedOut",
        canSignIn: health.loginCommand !== null,
      };
    case "unknown":
      return { status: "unknown", message: health.statusMessage };
  }
}

export function signInBrowserIsOnMachine({
  agentOnLocalDaemonHost,
  hostname,
  isDesktop,
}: {
  agentOnLocalDaemonHost: boolean;
  hostname: string | null;
  isDesktop: boolean;
}): boolean {
  return (
    agentOnLocalDaemonHost && viewerIsOnThisComputer({ hostname, isDesktop })
  );
}

export function resolveSignInCommand(
  health: Pick<SystemProviderState, "loginCommand" | "localLoginCommand">,
  browserIsOnMachine: boolean,
): string | null {
  return browserIsOnMachine && health.localLoginCommand !== null
    ? health.localLoginCommand
    : health.loginCommand;
}

export function agentContinueDisabled({
  redesign,
  agentReady,
  statesLoading,
}: {
  redesign: boolean;
  agentReady: boolean;
  statesLoading: boolean;
}): boolean {
  return redesign ? statesLoading : !agentReady;
}

export function projectsPrimaryAction({
  selectedCount,
  existingProjectIds,
  projectIds,
}: {
  selectedCount: number;
  existingProjectIds: ReadonlySet<string> | null;
  projectIds: readonly string[];
}): "import" | StepOutcome {
  if (selectedCount > 0) return "import";
  const added =
    existingProjectIds !== null &&
    projectIds.some((id) => !existingProjectIds.has(id));
  return added ? "completed" : "skipped";
}

export function hasReadyAgent(
  providers: readonly SystemProviderState[] | undefined,
): boolean {
  return providers?.some((provider) => provider.status === "ready") ?? false;
}

type AgentStateTelemetryProperties = Extract<
  RecordTelemetryEventRequest,
  { name: "onboarding_agent_state" }
>["properties"];

export function agentStateTelemetryProperties(
  entry: AgentStateTelemetryProperties["entry"],
  states: readonly SystemProviderState[] | undefined,
): AgentStateTelemetryProperties {
  const hasUnknown =
    states?.some((state) => state.status === "unknown") ?? true;
  const installed =
    states?.some(
      (state) => state.status !== "not_installed" && state.status !== "unknown",
    ) ?? false;
  return {
    entry,
    agent_installed: installed ? true : hasUnknown ? null : false,
    agent_ready: hasReadyAgent(states) ? true : hasUnknown ? null : false,
    ...(states === undefined
      ? {}
      : {
          agent_statuses: Object.fromEntries(
            [...states]
              .sort((left, right) =>
                left.providerId.localeCompare(right.providerId),
              )
              .map((state) => [state.providerId, state.status]),
          ),
        }),
  };
}

const RECENT_REPO_WINDOW_MS = 7 * 86_400_000;
const DEFAULT_SELECTED_REPO_LIMIT = 5;

export function defaultSelectedRepoPaths(
  repos: readonly HostDiscoveredRepo[],
  now: number,
): Set<string> {
  const importable = repos.filter((repo) => repo.projectId === null);
  const recent = importable.filter(
    (repo) => now - Date.parse(repo.lastActivityAt) <= RECENT_REPO_WINDOW_MS,
  );
  const chosen =
    recent.length > 0
      ? recent.slice(0, DEFAULT_SELECTED_REPO_LIMIT)
      : importable.slice(0, 1);
  return new Set(chosen.map((repo) => repo.path));
}

export type OperationFailureReason =
  | "host_unavailable"
  | "timed_out"
  | "not_found"
  | "permission"
  | "other";

export function operationFailureReason(error: unknown): OperationFailureReason {
  if (error instanceof BbRequestTimeoutError) return "timed_out";
  const httpError = asHttpError(error);
  if (httpError === null) return "other";
  if (httpError.code === "host_unavailable") return "host_unavailable";
  if (httpError.code === "command_timeout" || httpError.status === 504) {
    return "timed_out";
  }
  if (httpError.status === 404) return "not_found";
  if (httpError.status === 401 || httpError.status === 403) {
    return "permission";
  }
  return "other";
}

export function shortRemoteName(originUrl: string | null): string | null {
  if (originUrl === null) return null;
  const match =
    /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?[^/:]+[/:](.+?)(?:\.git)?\/?$/iu.exec(
      originUrl.trim(),
    );
  const path = match?.[1];
  if (path === undefined) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments.length < 2 ? null : segments.slice(-2).join("/");
}

export function connectAccessUrl(
  serverAccess: ServerAccessStatus | undefined,
):
  | { status: "on"; url: string }
  | { status: "off" }
  | { status: "unavailable" } {
  const provider = serverAccess?.providers.find(
    (candidate) => candidate.pluginId === CONNECT_PLUGIN_ID,
  );
  if (provider === undefined) return { status: "unavailable" };
  if (
    provider.availability?.status === "available" &&
    provider.availability.serverUrl !== undefined
  ) {
    return { status: "on", url: provider.availability.serverUrl };
  }
  return { status: "off" };
}

export function devicesShowMachines(
  connect: ReturnType<typeof connectAccessUrl>,
): boolean {
  return connect.status === "on";
}

export function signInSiteName(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./u, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

export interface SignInGuide {
  url: string | null;
  userCode: string | null;
  acceptsPastedCode: boolean;
}

export type SignInLinkChoice = "first" | "last";

export interface AgentSignInView {
  guide: SignInGuide | null;
  terminalVisible: boolean;
  started: boolean;
}

export function agentSignInView({
  parsed,
  connect,
  outputText,
  fallbackDue,
  terminalChoice,
  signInLink,
}: {
  parsed: boolean;
  connect: boolean;
  outputText: string | null;
  fallbackDue: boolean;
  terminalChoice: boolean | null;
  signInLink: SignInLinkChoice;
}): AgentSignInView {
  const guide =
    parsed && outputText !== null
      ? parseSignInOutput(outputText, signInLink)
      : null;
  const hasOutput = outputText !== null && outputText.length > 0;
  return {
    guide,
    terminalVisible:
      terminalChoice ?? (!parsed || (fallbackDue && guide?.url == null)),
    started:
      guide?.url != null ||
      fallbackDue ||
      terminalChoice !== null ||
      connect ||
      (!parsed && hasOutput),
  };
}

const TERMINAL_OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const TERMINAL_CSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
const TERMINAL_HYPERLINK =
  /\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\u0007\u001b]+)(?:\u0007|\u001b\\)/gu;
const SIGN_IN_URL = /https:\/\/[^\s\u0007\u001b"'<>]+/u;
const SIGN_IN_USER_CODE =
  /(?<![A-Za-z0-9-])[A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?![A-Za-z0-9-])/u;
const SIGN_IN_PASTE_PROMPT = /paste (?:the |your )?(?:authorization )?code/iu;

export function stripTerminalSequences(output: string): string {
  return output
    .replace(TERMINAL_OSC_SEQUENCE, "")
    .replace(TERMINAL_CSI_SEQUENCE, "")
    .replace(/\r/gu, "");
}

export function connectFlowFailed(
  flow: TerminalConnectFlow,
  output: string,
): boolean {
  return flow.failure.test(stripTerminalSequences(output));
}

export function parseSignInOutput(
  output: string,
  signInLink: SignInLinkChoice,
): SignInGuide {
  const text = stripTerminalSequences(output);
  const hyperlinks = [...output.matchAll(TERMINAL_HYPERLINK)];
  const hyperlink = signInLink === "last" ? hyperlinks.at(-1) : hyperlinks[0];
  const url = hyperlink?.[1] ?? SIGN_IN_URL.exec(text)?.[0] ?? null;
  const withoutUrls = text.replace(new RegExp(SIGN_IN_URL.source, "gu"), " ");
  return {
    url,
    userCode: SIGN_IN_USER_CODE.exec(withoutUrls)?.[0] ?? null,
    acceptsPastedCode: SIGN_IN_PASTE_PROMPT.test(withoutUrls),
  };
}
