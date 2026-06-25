import { useCallback, useRef, useState } from "react";
import type {
  ProviderCliInstallAction,
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { ProviderCliInstallLogDialog } from "@/components/dialogs/ProviderCliInstallLogDialog";
import type { ProviderCliInstallLogDialogState } from "@/components/dialogs/ProviderCliInstallLogDialog";
import { appToast } from "@/components/ui/app-toast";
import { AppToastCommandDescription } from "@/components/ui/app-toast-descriptions";
import { installHostProviderCli } from "@/lib/api";

type ProviderCliInstallCompletedEvent = Extract<
  ProviderCliInstallEvent,
  { type: "completed" }
>;

export interface ProviderCliStatusEntry {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

export interface ProviderCliIssue {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
  action: ProviderCliStatus["installAction"];
  title: string;
  description: string;
  fingerprint: string;
  toastId: string;
}

export interface ProviderCliActionableIssue extends ProviderCliIssue {
  action: ProviderCliInstallAction;
}

type ProviderCliTitlePhase = "progress" | "success" | "failure" | "log";
type ProviderCliTitleTemplate = (displayName: string) => string;

interface GetProviderCliTitleParams {
  issue: ProviderCliActionableIssue;
  phase: ProviderCliTitlePhase;
}

interface UseProviderCliInstallRunnerArgs {
  hostId: string | null;
  onStatusUpdated?: () => void;
}

interface ShowProviderCliInstallFailureToastParams {
  issue: ProviderCliActionableIssue;
  log: string;
  message: string;
  onViewLog: (state: ProviderCliInstallLogDialogState) => void;
  toastId: string;
}

const PROVIDER_CLI_TITLE_TEMPLATES = {
  progress: {
    install: (displayName) => `Installing ${displayName}`,
    update: (displayName) => `Updating ${displayName}`,
  },
  success: {
    install: (displayName) => `${displayName} installed`,
    update: (displayName) => `${displayName} is up to date`,
  },
  failure: {
    install: (displayName) => `${displayName} install failed`,
    update: (displayName) => `${displayName} update failed`,
  },
  log: {
    install: (displayName) => `${displayName} install log`,
    update: (displayName) => `${displayName} update log`,
  },
} satisfies Record<
  ProviderCliTitlePhase,
  Record<ProviderCliInstallActionKind, ProviderCliTitleTemplate>
>;

const PROVIDER_CLI_INSTALL_TOAST_PROVIDERS = [
  "codex",
  "claudeCode",
] as const satisfies readonly ProviderCliKey[];

export function providerCliEntries(
  status: ProviderCliStatusResponse,
): ProviderCliStatusEntry[] {
  return PROVIDER_CLI_INSTALL_TOAST_PROVIDERS.map((provider) => ({
    provider,
    status: status[provider],
  }));
}

export function buildProviderCliIssue(
  entry: ProviderCliStatusEntry,
): ProviderCliIssue | null {
  const { provider, status } = entry;
  const toastId = `provider-cli-health:${provider}`;
  if (!status.installed) {
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} CLI not installed`,
      description: `Install ${status.displayName} so bb can start ${status.displayName} sessions.`,
      fingerprint: `${provider}:missing:${status.latestVersion ?? "latest"}`,
      toastId,
    };
  }

  if (status.versionUnsupported) {
    const currentVersion = status.currentVersion ?? "Installed version unknown";
    const minimumVersion = status.minimumSupportedVersion ?? "a newer version";
    const requiredDescription = status.minimumSupportedVersion
      ? `required ${status.minimumSupportedVersion}+`
      : "requires a newer version";
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} update needed`,
      description: `${currentVersion}; ${requiredDescription}`,
      fingerprint: [
        provider,
        "unsupported",
        status.installSource,
        status.currentVersion ?? "unknown",
        minimumVersion,
        status.executablePath ?? status.executableName,
      ].join(":"),
      toastId,
    };
  }

  if (status.needsUpdate) {
    if (status.installAction === null) {
      return null;
    }
    const description = `${status.currentVersion ?? "Installed version unknown"} -> ${status.latestVersion ?? "latest"}`;
    const fingerprint = [
      provider,
      "outdated",
      status.installSource,
      status.currentVersion ?? "unknown",
      status.latestVersion ?? "unknown",
      status.executablePath ?? status.executableName,
    ].join(":");
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} update available`,
      description,
      fingerprint,
      toastId,
    };
  }

  return null;
}

export function isProviderCliIssue(
  issue: ProviderCliIssue | null,
): issue is ProviderCliIssue {
  return issue !== null;
}

export function hasProviderCliAction(
  issue: ProviderCliIssue,
): issue is ProviderCliActionableIssue {
  return issue.action !== null;
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

function getProviderCliRunToastId(provider: ProviderCliKey): string {
  return `provider-cli-health-run:${provider}`;
}

function getProviderCliTitle({
  issue,
  phase,
}: GetProviderCliTitleParams): string {
  return PROVIDER_CLI_TITLE_TEMPLATES[phase][issue.action.kind](
    issue.status.displayName,
  );
}

function showProviderCliInstallFailureToast({
  issue,
  log,
  message,
  onViewLog,
  toastId,
}: ShowProviderCliInstallFailureToastParams): void {
  const logDialogState: ProviderCliInstallLogDialogState = {
    displayName: issue.status.displayName,
    log,
    message,
    title: getProviderCliTitle({ issue, phase: "log" }),
  };

  appToast.error(getProviderCliTitle({ issue, phase: "failure" }), {
    id: toastId,
    description: message,
    action: {
      label: "View log",
      onClick: () => onViewLog(logDialogState),
    },
  });
}

export function useProviderCliInstallRunner({
  hostId,
  onStatusUpdated,
}: UseProviderCliInstallRunnerArgs) {
  const runningProviderRef = useRef<ProviderCliKey | null>(null);
  const [runningProvider, setRunningProvider] = useState<ProviderCliKey | null>(
    null,
  );
  const [logDialogState, setLogDialogState] =
    useState<ProviderCliInstallLogDialogState | null>(null);

  const handleCloseProviderCliInstallLog = useCallback(() => {
    setLogDialogState(null);
  }, []);

  const startInstall = useCallback(
    (issue: ProviderCliActionableIssue) => {
      const action = issue.action;
      if (hostId === null) {
        appToast.error("Work host unavailable", {
          description: "Reconnect the bb host and retry the provider CLI setup.",
        });
        return;
      }
      if (runningProviderRef.current !== null) {
        appToast.warning("Provider CLI setup already running", {
          description: "Wait for the current install or update to finish.",
        });
        return;
      }

      runningProviderRef.current = issue.provider;
      setRunningProvider(issue.provider);
      appToast.dismiss(issue.toastId);
      const runToastId = getProviderCliRunToastId(issue.provider);
      let installLogChunks = [`$ ${action.command}\n`];
      let completedEvent: ProviderCliInstallCompletedEvent | null = null;
      let errorMessage: string | null = null;

      appToast.loading(getProviderCliTitle({ issue, phase: "progress" }), {
        id: runToastId,
        description: <AppToastCommandDescription command={action.command} />,
      });

      void installHostProviderCli({
        hostId,
        request: {
          provider: issue.provider,
          actionKind: action.kind,
        },
        onEvent: (event) => {
          if (event.provider !== issue.provider) {
            return;
          }
          switch (event.type) {
            case "started":
              installLogChunks = [`$ ${event.command}\n`];
              appToast.loading(
                getProviderCliTitle({ issue, phase: "progress" }),
                {
                  id: runToastId,
                  description: (
                    <AppToastCommandDescription command={event.command} />
                  ),
                },
              );
              break;
            case "output":
              if (event.text.length > 0) {
                installLogChunks.push(event.text);
              }
              break;
            case "completed":
              completedEvent = event;
              break;
            case "error":
              errorMessage = event.message;
              installLogChunks.push(`\n${event.message}\n`);
              break;
          }
        },
      })
        .then(() => {
          if (completedEvent?.success) {
            appToast.success(getProviderCliTitle({ issue, phase: "success" }), {
              id: runToastId,
            });
            onStatusUpdated?.();
            return;
          }

          const failureMessage =
            errorMessage ??
            (completedEvent
              ? exitDescription(completedEvent)
              : "Command finished without reporting success.");
          showProviderCliInstallFailureToast({
            issue,
            log: installLogChunks.join(""),
            message: failureMessage,
            onViewLog: setLogDialogState,
            toastId: runToastId,
          });
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          installLogChunks.push(`\n${message}\n`);
          showProviderCliInstallFailureToast({
            issue,
            log: installLogChunks.join(""),
            message,
            onViewLog: setLogDialogState,
            toastId: runToastId,
          });
        })
        .finally(() => {
          if (runningProviderRef.current === issue.provider) {
            runningProviderRef.current = null;
            setRunningProvider(null);
          }
        });
    },
    [hostId, onStatusUpdated],
  );

  return {
    installLogDialog: (
      <ProviderCliInstallLogDialog
        state={logDialogState}
        onClose={handleCloseProviderCliInstallLog}
      />
    ),
    runningProvider,
    startInstall,
  };
}
