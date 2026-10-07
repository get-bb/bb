import type { ProviderCliStatus } from "@bb/host-daemon-contract";
import type {
  HostDiscoveredRepo,
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

export const ONBOARDING_PLUGINS: readonly {
  entryId: string;
  pluginId: string;
}[] = [
  { entryId: "browser-automation", pluginId: "browser-automation" },
  { entryId: "workflows", pluginId: "workflows" },
  { entryId: "monaco-editor", pluginId: "monaco-editor" },
  { entryId: "prompt-library", pluginId: "bb--prompt-library" },
  { entryId: "agent-annotations", pluginId: "agent-annotations" },
  { entryId: "ask-user-question", pluginId: "ask-user-question" },
];

export const CONNECT_PLUGIN_ID = "connect";

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
  | { status: "installing" }
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
  if (installing) return { status: "installing" };
  const canInstall =
    cliStatus?.installAction !== null && cliStatus?.installAction !== undefined;
  if (installFailure !== null) {
    return { status: "installFailed", message: installFailure, canInstall };
  }
  const awaitingInstallInfo = cliStatus === undefined && installInfoPending;
  switch (health.status) {
    case "not_installed":
      return awaitingInstallInfo
        ? { status: "checking" }
        : { status: "install", canInstall };
    case "unsupported_version":
      if (awaitingInstallInfo) return { status: "checking" };
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

export function resolveSignInCommand(
  health: Pick<SystemProviderState, "loginCommand" | "localLoginCommand">,
  browserIsOnMachine: boolean,
): string | null {
  return browserIsOnMachine && health.localLoginCommand !== null
    ? health.localLoginCommand
    : health.loginCommand;
}

export function hasReadyAgent(
  providers: readonly SystemProviderState[] | undefined,
): boolean {
  return providers?.some((provider) => provider.status === "ready") ?? false;
}

export function hasNoUsableAgent(
  providers: readonly SystemProviderState[] | undefined,
): boolean {
  if (providers === undefined || providers.length === 0) return false;
  return providers.every(
    (provider) => provider.status !== "ready" && provider.status !== "unknown",
  );
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

export interface SignInGuide {
  url: string | null;
  userCode: string | null;
  acceptsPastedCode: boolean;
}

const TERMINAL_OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const TERMINAL_CSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
const TERMINAL_HYPERLINK =
  /\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\u0007\u001b]+)(?:\u0007|\u001b\\)/u;
const SIGN_IN_URL = /https:\/\/[^\s\u0007\u001b"'<>]+/u;
const SIGN_IN_USER_CODE =
  /(?<![A-Za-z0-9-])[A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?![A-Za-z0-9-])/u;
const SIGN_IN_PASTE_PROMPT = /paste (?:the |your )?(?:authorization )?code/iu;

export function parseSignInOutput(output: string): SignInGuide {
  const text = output
    .replace(TERMINAL_OSC_SEQUENCE, "")
    .replace(TERMINAL_CSI_SEQUENCE, "")
    .replace(/\r/gu, "");
  const url =
    TERMINAL_HYPERLINK.exec(output)?.[1] ?? SIGN_IN_URL.exec(text)?.[0] ?? null;
  const withoutUrls = text.replace(new RegExp(SIGN_IN_URL.source, "gu"), " ");
  return {
    url,
    userCode: SIGN_IN_USER_CODE.exec(withoutUrls)?.[0] ?? null,
    acceptsPastedCode: SIGN_IN_PASTE_PROMPT.test(withoutUrls),
  };
}
