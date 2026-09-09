import type {
  DesktopBrowserImportFailureReason,
  DesktopBrowserImportOutcome,
  DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";

export type BrowserImportWizardStep =
  | { step: "detecting" }
  | { step: "chooseSource" }
  | { step: "quit" }
  | { step: "fullDiskAccess"; checked: boolean }
  | { step: "configure" }
  | { step: "checking" }
  | { step: "importing" }
  | {
      step: "done";
      imported: number;
      skipped: number;
      skippedDomains: readonly string[];
    }
  | { step: "blocked"; reason: DesktopBrowserImportFailureReason };

export function initialBrowserImportStep(
  source: DesktopBrowserImportSource,
): BrowserImportWizardStep {
  if (source.unavailable === "browserRunning") return { step: "quit" };
  if (source.unavailable === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: false };
  if (source.unavailable !== undefined)
    return { step: "blocked", reason: source.unavailable };
  if (source.profiles.length === 0)
    return { step: "blocked", reason: "unknownSourceProfile" };
  return { step: "configure" };
}

export function outcomeToBrowserImportStep(
  outcome: DesktopBrowserImportOutcome,
): BrowserImportWizardStep {
  if (outcome.ok) {
    return {
      step: "done",
      imported: outcome.imported,
      skipped: outcome.skipped,
      skippedDomains: outcome.skippedDomains,
    };
  }
  if (outcome.reason === "browserRunning") return { step: "quit" };
  if (outcome.reason === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return { step: "blocked", reason: outcome.reason };
}

export function refreshedBrowserImportStep(
  source: DesktopBrowserImportSource | undefined,
  previous: BrowserImportWizardStep,
): BrowserImportWizardStep {
  if (source === undefined) return { step: "blocked", reason: "unknownSource" };
  const next = initialBrowserImportStep(source);
  if (next.step === "fullDiskAccess" && previous.step === "fullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return next;
}

export function canCloseBrowserImportWizard(
  step: BrowserImportWizardStep,
): boolean {
  return step.step !== "importing";
}

export function canReturnToSourceChoice(
  step: BrowserImportWizardStep,
): boolean {
  return (
    step.step === "configure" ||
    step.step === "quit" ||
    step.step === "fullDiskAccess" ||
    step.step === "blocked"
  );
}

export function preferredSourceProfileDirectory(
  current: string | null,
  source: DesktopBrowserImportSource,
): string | null {
  if (
    current !== null &&
    source.profiles.some((profile) => profile.directory === current)
  )
    return current;
  return source.profiles[0]?.directory ?? null;
}

export function formatCookieCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "cookie" : "cookies"}`;
}

export function formatSkippedDomains(domains: readonly string[]): string {
  if (domains.length === 0) return "";
  if (domains.length === 1) return domains[0];
  if (domains.length <= 3)
    return `${domains.slice(0, -1).join(", ")} and ${domains[domains.length - 1]}`;
  return `${domains.slice(0, 3).join(", ")} and ${domains.length - 3} more`;
}

export function describeSourceProfiles(
  source: DesktopBrowserImportSource,
): string {
  if (source.unavailable === "notInstalled") return "Not found on this machine";
  if (source.unavailable === "unsupportedPlatform")
    return "Not supported on this platform";
  if (source.unavailable === "needsFullDiskAccess")
    return "Needs Full Disk Access to read its cookies";
  if (source.unavailable === "browserRunning")
    return "Quit it before importing";
  if (source.profiles.length === 0) return "No profiles with cookies";
  const names = source.profiles
    .map((profile) =>
      profile.cookieCount === undefined
        ? profile.name
        : `${profile.name} (${formatCookieCount(profile.cookieCount)})`,
    )
    .join(", ");
  return `${source.profiles.length} ${
    source.profiles.length === 1 ? "profile" : "profiles"
  } · ${names}`;
}

export function isSourceSelectable(
  source: DesktopBrowserImportSource,
): boolean {
  return (
    source.unavailable === undefined ||
    source.unavailable === "browserRunning" ||
    source.unavailable === "needsFullDiskAccess"
  );
}

export function detectedSources(
  sources: readonly DesktopBrowserImportSource[],
): DesktopBrowserImportSource[] {
  return sources.filter(
    (source) =>
      source.unavailable !== "unsupportedPlatform" &&
      source.unavailable !== "notInstalled",
  );
}

export type SourceStatusTone = "ready" | "attention" | "muted";

export function sourceStatus(source: DesktopBrowserImportSource): {
  label: string;
  tone: SourceStatusTone;
} {
  switch (source.unavailable) {
    case undefined:
      return { label: "Ready", tone: "ready" };
    case "browserRunning":
      return { label: "Quit first", tone: "attention" };
    case "needsFullDiskAccess":
      return { label: "Needs permission", tone: "attention" };
    case "notInstalled":
      return { label: "Not installed", tone: "muted" };
    default:
      return { label: "Unavailable", tone: "muted" };
  }
}
