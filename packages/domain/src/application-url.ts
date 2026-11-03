import type { ApplicationLinkApprovals } from "./application-link-approvals.js";

const BLOCKED_SCHEMES = new Set([
  "http",
  "https",
  "mailto",
  "file",
  "javascript",
  "vbscript",
  "data",
  "blob",
  "about",
  "filesystem",
  "chrome",
  "chrome-extension",
  "devtools",
  "view-source",
  "resource",
  "ms-msdt",
  "search-ms",
  "ms-appinstaller",
  "ms-officecmd",
  "shell",
  "smb",
  "bb",
  "vscode",
  "vscode-insiders",
  "cursor",
  "devin",
  "windsurf",
]);

export interface ApplicationUrl {
  url: string;
  scheme: string;
}

export function parseApplicationUrl(value: unknown): ApplicationUrl | null {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    /[\s\u0000-\u001f\u007f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value) ||
    !/^[a-z][a-z0-9+.-]*:/iu.test(value)
  )
    return null;
  try {
    const parsed = new URL(value);
    const scheme = parsed.protocol.slice(0, -1);
    if (BLOCKED_SCHEMES.has(scheme) || parsed.username || parsed.password)
      return null;
    return { url: value, scheme };
  } catch {
    return null;
  }
}

export type ApplicationUrlDecision = "cancel" | "open" | "always";

export function createApplicationUrlOpener({
  confirm,
  open,
  approvals,
}: {
  confirm: (target: ApplicationUrl) => Promise<ApplicationUrlDecision>;
  open: (url: string) => void | Promise<void>;
  approvals?: ApplicationLinkApprovals;
}): (value: unknown) => Promise<void> {
  let pending = false;
  return async (value) => {
    const target = parseApplicationUrl(value);
    if (target === null)
      throw new Error("This application link is blocked or invalid.");
    if (pending) return;
    pending = true;
    try {
      const revision = approvals?.revision();
      const decision = approvals?.list().includes(target.scheme)
        ? "open"
        : await confirm(target);
      if (decision === "cancel") return;
      await open(target.url);
      if (decision === "always" && revision !== undefined)
        await approvals?.allow(target.scheme, revision);
    } finally {
      pending = false;
    }
  };
}
