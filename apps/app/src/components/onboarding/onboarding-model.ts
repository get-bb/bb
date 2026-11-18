import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import { BbRequestTimeoutError } from "@bb/sdk/browser";
import { asHttpError } from "@/lib/http-error";
import { viewerIsOnThisComputer } from "@/lib/local-host-daemon-access";
import type {
  HostDiscoveredRepo,
  RecordTelemetryEventRequest,
  ServerAccessStatus,
  SystemProviderState,
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

interface StepCopy {
  title: string;
  description: string;
  primaryLabel: string;
}

export const STEP_COPY: Readonly<Record<OnboardingStepId, StepCopy>> = {
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
  | { status: "unknown"; message: string | null }
  | {
      status: "checkFailed";
      message: string;
      detail: string | null;
      retrying: boolean;
    };

interface ResolveAgentSetupStateArgs {
  health: SystemProviderState;
  cliStatus: ProviderCliStatus | undefined;
  installing: boolean;
  installFailure: string | null;
  signingIn: boolean;
  signInFailed: boolean;
  installInfoPending: boolean;
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
    awaitingInstallInfo ||
    (cliStatus?.installAction !== null &&
      cliStatus?.installAction !== undefined);
  if (installFailure !== null) {
    return { status: "installFailed", message: installFailure, canInstall };
  }
  switch (health.status) {
    case "not_installed":
      return { status: "install", canInstall };
    case "unsupported_version":
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

export type AgentCheck =
  | { providerId: string; kind: "pending" }
  | { providerId: string; kind: "unchecked" }
  | {
      providerId: string;
      kind: "answered";
      state: SystemProviderState;
      settledAt: number;
    }
  | { providerId: string; kind: "absent"; settledAt: number }
  | { providerId: string; kind: "failed"; error: unknown; settledAt: number };

export type AgentCheckFailure = "timed_out" | "other";

export type AgentRowSoFar =
  | { kind: "agent"; state: SystemProviderState }
  | {
      kind: "failed";
      providerId: string;
      name: string;
      failure: AgentCheckFailure;
      detail: string | null;
      retrying: boolean;
    }
  | { kind: "loading"; key: string };

export function agentCheckFailedMessage(failure: AgentCheckFailure): string {
  return failure === "timed_out"
    ? "Didn't respond in time."
    : "Couldn't load agent";
}

export type AgentListFailure = "host_unavailable" | "other";

export function agentListFailure({
  hostConnected,
  errors,
}: {
  hostConnected: boolean;
  errors: readonly unknown[];
}): AgentListFailure {
  return !hostConnected ||
    errors.some((error) => operationFailureReason(error) === "host_unavailable")
    ? "host_unavailable"
    : "other";
}

export function agentListFailedMessage({
  failure,
  machineName,
}: {
  failure: AgentListFailure;
  machineName: string | null;
}): string {
  return failure === "host_unavailable"
    ? `Can't reach ${machineName ?? "this computer"}. Make sure bb is running there, then retry.`
    : "Couldn't load agents";
}

function checkFailure(error: unknown): AgentCheckFailure {
  return operationFailureReason(error) === "timed_out" ? "timed_out" : "other";
}

function stateRow(
  state: SystemProviderState,
  retrying: boolean,
): AgentRowSoFar {
  return state.status === "unknown"
    ? {
        kind: "failed",
        providerId: state.providerId,
        name: state.displayName,
        failure: "other",
        detail: state.statusMessage,
        retrying,
      }
    : { kind: "agent", state };
}

function checkRow(
  check: Exclude<AgentCheck, { kind: "pending" | "unchecked" }>,
  names: ReadonlyMap<string, string>,
): AgentRowSoFar | null {
  switch (check.kind) {
    case "answered":
      return stateRow(check.state, false);
    case "absent":
      return null;
    case "failed":
      return {
        kind: "failed",
        providerId: check.providerId,
        name: names.get(check.providerId) ?? check.providerId,
        failure: checkFailure(check.error),
        detail: null,
        retrying: false,
      };
  }
}

export function resolveAgentRows({
  states,
  statesSettledAt,
  checks,
  names,
}: {
  states: readonly SystemProviderState[] | undefined;
  statesSettledAt: number;
  checks: readonly AgentCheck[];
  names: ReadonlyMap<string, string>;
}): AgentRowSoFar[] | undefined {
  if (states !== undefined) {
    return states.flatMap((state) => {
      const check = checks.find(
        (candidate) => candidate.providerId === state.providerId,
      );
      if (
        check !== undefined &&
        check.kind !== "pending" &&
        check.kind !== "unchecked" &&
        check.settledAt > statesSettledAt
      ) {
        const row = checkRow(check, names);
        return row === null ? [] : [row];
      }
      return [stateRow(state, check?.kind === "pending")];
    });
  }
  let lastShown = -1;
  checks.forEach((check, index) => {
    if (check.kind === "answered" || check.kind === "failed") {
      lastShown = index;
    }
  });
  if (lastShown === -1) return undefined;
  const rows: AgentRowSoFar[] = [];
  for (const check of checks.slice(0, lastShown + 1)) {
    if (check.kind === "pending" || check.kind === "unchecked") {
      rows.push({ kind: "loading", key: check.providerId });
      continue;
    }
    const row = checkRow(check, names);
    if (row !== null) rows.push(row);
  }
  if (
    checks
      .slice(lastShown + 1)
      .some((check) => check.kind === "pending" || check.kind === "unchecked")
  ) {
    rows.push({ kind: "loading", key: "more" });
  }
  return rows;
}

export function failedAgentProviderIds(
  rows: readonly AgentRowSoFar[] | undefined,
  checks: readonly AgentCheck[],
): string[] {
  const failed =
    rows === undefined
      ? checks.flatMap((check) =>
          check.kind === "failed" ? [check.providerId] : [],
        )
      : rows.flatMap((row) => (row.kind === "failed" ? [row.providerId] : []));
  return failed.length > 0 || rows !== undefined
    ? failed
    : checks.map((check) => check.providerId);
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
  "host_unavailable" | "timed_out" | "not_found" | "permission" | "other";

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
}: {
  parsed: boolean;
  connect: boolean;
  outputText: string | null;
  fallbackDue: boolean;
  terminalChoice: boolean | null;
}): AgentSignInView {
  const guide =
    parsed && outputText !== null ? parseSignInOutput(outputText) : null;
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

export function parseSignInOutput(output: string): SignInGuide {
  const text = stripTerminalSequences(output);
  const url =
    [...output.matchAll(TERMINAL_HYPERLINK)].at(-1)?.[1] ??
    SIGN_IN_URL.exec(text)?.[0] ??
    null;
  const withoutUrls = text.replace(new RegExp(SIGN_IN_URL.source, "gu"), " ");
  return {
    url,
    userCode: SIGN_IN_USER_CODE.exec(withoutUrls)?.[0] ?? null,
    acceptsPastedCode: SIGN_IN_PASTE_PROMPT.test(withoutUrls),
  };
}
