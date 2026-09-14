import type {
  DesktopBrowserImportFailureReason,
  DesktopBrowserImportOutcome,
  DesktopBrowserImportSource,
} from "@bb/host-daemon-contract";

export interface BrowserImportRecord {
  at: number;
  profileName: string;
  imported: number;
  skipped: number;
  skippedDomains: readonly string[];
}

export type BrowserImportRecords = Readonly<
  Partial<Record<DesktopBrowserImportSource["id"], BrowserImportRecord>>
>;

export const BROWSER_IMPORT_RECORDS_STORAGE_KEY = "bb:browser-import:records";

export function readBrowserImportRecords(
  storage: Pick<Storage, "getItem"> | null,
): BrowserImportRecords {
  try {
    const raw = storage?.getItem(BROWSER_IMPORT_RECORDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const records: Partial<Record<string, BrowserImportRecord>> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const record = value as Partial<BrowserImportRecord>;
      if (
        typeof record.at !== "number" ||
        typeof record.profileName !== "string" ||
        typeof record.imported !== "number" ||
        typeof record.skipped !== "number" ||
        !Array.isArray(record.skippedDomains)
      )
        continue;
      records[id] = {
        at: record.at,
        profileName: record.profileName,
        imported: record.imported,
        skipped: record.skipped,
        skippedDomains: record.skippedDomains.filter(
          (domain): domain is string => typeof domain === "string",
        ),
      };
    }
    return records as BrowserImportRecords;
  } catch {
    return {};
  }
}

export type BrowserImportDialogStep =
  | { step: "configure" }
  | { step: "fullDiskAccess"; checked: boolean }
  | { step: "checking" }
  | { step: "importing" }
  | { step: "blocked"; reason: DesktopBrowserImportFailureReason };

export function initialDialogStep(
  source: DesktopBrowserImportSource,
): BrowserImportDialogStep {
  if (source.unavailable === "browserRunning")
    return { step: "blocked", reason: "browserRunning" };
  if (source.unavailable === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: false };
  if (source.unavailable !== undefined)
    return { step: "blocked", reason: source.unavailable };
  if (source.profiles.length === 0)
    return { step: "blocked", reason: "unknownSourceProfile" };
  return { step: "configure" };
}

export function failedDialogStep(
  reason: DesktopBrowserImportFailureReason,
): BrowserImportDialogStep {
  if (reason === "needsFullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return { step: "blocked", reason };
}

export function sourceAfterFailure(
  source: DesktopBrowserImportSource,
  reason: DesktopBrowserImportFailureReason,
): DesktopBrowserImportSource | null {
  switch (reason) {
    case "browserRunning":
    case "needsFullDiskAccess":
    case "needsKeychainApproval":
    case "keychainItemMissing":
      return { ...source, unavailable: reason };
    default:
      return null;
  }
}

export function refreshedDialogStep(
  source: DesktopBrowserImportSource | undefined,
  previous: BrowserImportDialogStep,
): BrowserImportDialogStep {
  if (source === undefined) return { step: "blocked", reason: "unknownSource" };
  const next = initialDialogStep(source);
  if (next.step === "fullDiskAccess" && previous.step === "fullDiskAccess")
    return { step: "fullDiskAccess", checked: true };
  return next;
}

export function canCloseDialog(step: BrowserImportDialogStep): boolean {
  return step.step !== "importing";
}

export function needsProfileChoice(
  source: DesktopBrowserImportSource,
): boolean {
  return source.unavailable === undefined && source.profiles.length > 1;
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

export function recordFromOutcome(
  outcome: DesktopBrowserImportOutcome & { ok: true },
  profileName: string,
  at: number,
): BrowserImportRecord {
  return {
    at,
    profileName,
    imported: outcome.imported,
    skipped: outcome.skipped,
    skippedDomains: outcome.skippedDomains,
  };
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

export function listedSources(
  sources: readonly DesktopBrowserImportSource[],
): DesktopBrowserImportSource[] {
  return sources.filter(
    (source) =>
      source.unavailable !== "unsupportedPlatform" &&
      source.unavailable !== "notInstalled",
  );
}

export type SourceRowTone = "ready" | "attention" | "idle";

export interface SourceRowPresentation {
  status: string;
  tone: SourceRowTone;
  details: string[];
  action: "import" | "recheck" | "grant" | "none";
  actionLabel: string;
}

export function totalCookies(
  source: DesktopBrowserImportSource,
): number | undefined {
  let total = 0;
  let known = false;
  for (const profile of source.profiles) {
    if (profile.cookieCount === undefined) return undefined;
    total += profile.cookieCount;
    known = true;
  }
  return known ? total : undefined;
}

export function presentSourceRow(
  source: DesktopBrowserImportSource,
  record: BrowserImportRecord | undefined,
): SourceRowPresentation {
  const profileCount = source.profiles.length;
  const profileLabel = `${profileCount} ${profileCount === 1 ? "profile" : "profiles"}`;
  const cookies = totalCookies(source);
  switch (source.unavailable) {
    case "browserRunning":
      return {
        status: `Running · quit ${source.name} to import`,
        tone: "attention",
        details: [],
        action: "recheck",
        actionLabel: "Recheck",
      };
    case "needsFullDiskAccess":
      return {
        status: "Needs Full Disk Access",
        tone: "attention",
        details: [],
        action: "grant",
        actionLabel: "Grant access…",
      };
    case "needsKeychainApproval":
      return {
        status: "Needs Keychain access",
        tone: "attention",
        details: [],
        action: "import",
        actionLabel: "Import…",
      };
    case "keychainItemMissing":
      return {
        status: "No encryption key in Keychain",
        tone: "idle",
        details: [],
        action: "recheck",
        actionLabel: "Recheck",
      };
    case undefined:
      break;
    default:
      return {
        status: "Unavailable",
        tone: "idle",
        details: [],
        action: "none",
        actionLabel: "Import…",
      };
  }
  if (profileCount === 0 || cookies === 0) {
    return {
      status: "No cookies yet",
      tone: "idle",
      details: profileCount === 0 ? [] : [profileLabel],
      action: "none",
      actionLabel: "Import…",
    };
  }
  const details = record
    ? [
        `${record.profileName} · ${formatCookieCount(record.imported)} imported`,
        ...(record.skipped > 0
          ? [
              `${record.skipped.toLocaleString()} skipped${
                record.skippedDomains.length > 0
                  ? ` (${formatSkippedDomains(record.skippedDomains)})`
                  : ""
              }`,
            ]
          : []),
      ]
    : cookies === undefined
      ? [profileLabel]
      : [profileLabel, formatCookieCount(cookies)];
  return {
    status: "Ready",
    tone: "ready",
    details,
    action: "import",
    actionLabel: "Import…",
  };
}
