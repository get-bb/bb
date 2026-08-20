import type {
  ProviderCliInstallAction,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract/local";

/**
 * Provider CLI inventory helpers (mirror of
 * apps/app/src/components/provider-cli/provider-cli-install.tsx): which rows
 * a machine shows, what is wrong with each, and whether bb can fix it.
 */

export interface ProviderCliStatusEntry {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
}

export interface ProviderCliIssue {
  provider: ProviderCliKey;
  status: ProviderCliStatus;
  action: ProviderCliInstallAction | null;
  title: string;
  description: string;
  /** Identity of this exact problem, so a stored failure is dropped once it changes. */
  fingerprint: string;
}

export interface ProviderCliActionableIssue extends ProviderCliIssue {
  action: ProviderCliInstallAction;
}

export function providerCliEntries(
  status: ProviderCliStatusResponse,
): ProviderCliStatusEntry[] {
  return Object.entries(status).map(([provider, entry]) => ({
    provider,
    status: entry,
  }));
}

export function buildProviderCliIssue(
  entry: ProviderCliStatusEntry,
): ProviderCliIssue | null {
  const { provider, status } = entry;
  if (!status.installed) {
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} CLI not installed`,
      description: `Install ${status.displayName} so bb can start ${status.displayName} sessions.`,
      fingerprint: `${provider}:missing:${status.latestVersion ?? "latest"}`,
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
    };
  }
  if (status.needsUpdate) {
    const currentVersion = status.currentVersion ?? "Installed version unknown";
    const description =
      status.latestVersion === null
        ? `${currentVersion}; newer release available`
        : `${currentVersion} -> ${status.latestVersion}`;
    return {
      provider,
      status,
      action: status.installAction,
      title: `${status.displayName} update available`,
      description,
      fingerprint: [
        provider,
        "outdated",
        status.installSource,
        status.currentVersion ?? "unknown",
        status.latestVersion ?? "unknown",
        status.executablePath ?? status.executableName,
      ].join(":"),
    };
  }
  return null;
}

export function providerCliIssues(
  status: ProviderCliStatusResponse,
): ProviderCliIssue[] {
  return providerCliEntries(status)
    .map(buildProviderCliIssue)
    .filter((issue): issue is ProviderCliIssue => issue !== null);
}

export function hasProviderCliAction(
  issue: ProviderCliIssue,
): issue is ProviderCliActionableIssue {
  return issue.action !== null;
}

export type ProviderCliRowTone = "default" | "attention" | "destructive";

export interface ProviderCliRowState {
  label: string;
  tone: ProviderCliRowTone;
}

/**
 * The row's status label. Healthy rows get none (the version alone says it);
 * only exceptions speak (web `providerRowState`).
 */
export function providerCliRowState({
  issue,
  installed,
}: {
  issue: ProviderCliIssue | null;
  installed: boolean;
}): ProviderCliRowState | null {
  if (!installed) return { label: "Not installed", tone: "default" };
  if (issue === null) return null;
  if (issue.action === null) {
    return {
      label: "Update manually",
      tone: issue.status.versionUnsupported ? "destructive" : "attention",
    };
  }
  if (issue.status.versionUnsupported) {
    return { label: "Update needed", tone: "destructive" };
  }
  return { label: "Available", tone: "attention" };
}

/** "Codex 0.1.2 · Claude Code 1.0" for the installed CLIs (web `providerSummary`). */
export function summarizeInstalledProviderClis(
  status: ProviderCliStatusResponse,
): string | null {
  const parts = Object.values(status)
    .filter((entry) => entry.installed)
    .map((entry) =>
      entry.currentVersion
        ? `${entry.displayName} ${entry.currentVersion}`
        : entry.displayName,
    );
  return parts.length > 0 ? parts.join(" · ") : null;
}

// --- Install stream ------------------------------------------------------------

export type ProviderCliInstallCompletedEvent = Extract<
  ProviderCliInstallEvent,
  { type: "completed" }
>;

/** What an install run's events add up to (web `runInstall` accumulation). */
export interface ProviderCliInstallOutcome {
  log: string;
  completed: ProviderCliInstallCompletedEvent | null;
  errorMessage: string | null;
  success: boolean;
  /** What to show for a failure: the error event, else the exit, else a generic note. */
  failureMessage: string | null;
}

function exitDescription(event: ProviderCliInstallCompletedEvent): string {
  if (event.exitCode !== null) {
    return `Command exited with code ${event.exitCode}`;
  }
  return `Command exited after signal ${event.signal ?? "unknown"}`;
}

export const PROVIDER_CLI_FAILURE_LOG_MAX_CHARS = 128 * 1024;
const LOG_TRUNCATION_MARKER = "\n\n… provider update output truncated …\n\n";

/** Keep the head and tail of an oversized log (web `truncateProviderCliFailureLog`, by chars). */
export function truncateProviderCliLog(log: string): string {
  if (log.length <= PROVIDER_CLI_FAILURE_LOG_MAX_CHARS) return log;
  const budget =
    PROVIDER_CLI_FAILURE_LOG_MAX_CHARS - LOG_TRUNCATION_MARKER.length;
  const head = Math.floor(budget / 2);
  const tail = budget - head;
  return `${log.slice(0, head)}${LOG_TRUNCATION_MARKER}${log.slice(-tail)}`;
}

/** Accumulates install events for one provider into a log + outcome. */
export function createProviderCliInstallAccumulator(args: {
  provider: ProviderCliKey;
  command: string;
}) {
  let chunks: string[] = [`$ ${args.command}\n`];
  let completed: ProviderCliInstallCompletedEvent | null = null;
  let errorMessage: string | null = null;

  return {
    push(event: ProviderCliInstallEvent): void {
      if (event.provider !== args.provider) return;
      switch (event.type) {
        case "started":
          chunks = [`$ ${event.command}\n`];
          break;
        case "output":
          if (event.text.length > 0) chunks.push(event.text);
          break;
        case "completed":
          completed = event;
          break;
        case "error":
          errorMessage = event.message;
          chunks.push(`\n${event.message}\n`);
          break;
      }
    },
    /** A transport failure outside the event stream. */
    fail(message: string): void {
      errorMessage = message;
      chunks.push(`\n${message}\n`);
    },
    log(): string {
      return chunks.join("");
    },
    outcome(): ProviderCliInstallOutcome {
      const success = completed?.success === true && errorMessage === null;
      const completedEvent: ProviderCliInstallCompletedEvent | null = completed;
      return {
        log: truncateProviderCliLog(chunks.join("")),
        completed: completedEvent,
        errorMessage,
        success,
        failureMessage: success
          ? null
          : (errorMessage ??
            (completedEvent !== null
              ? exitDescription(completedEvent)
              : "Command finished without reporting success.")),
      };
    },
  };
}
