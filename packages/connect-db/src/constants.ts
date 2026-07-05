// bb connect cloud policy constants. Single source of truth — the worker, the
// dashboard, and migrations reference these rather than scattering literals
// (see plans/bb-connect-v1.md "Cross-cutting rules").

/**
 * Handle grammar: 3–30 chars, lowercase alphanumeric + internal hyphens, must
 * start with an alphanumeric. Becomes a DNS label in `<handle>.getbb.app`, so
 * it must stay within LDH label rules.
 */
export const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/**
 * Subdomains reserved for the platform — never claimable as user handles.
 * Includes current + plausibly-future service names and common lure targets.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "admin",
  "connect",
  "download",
  "downloads",
  "docs",
  "doc",
  "status",
  "staging",
  "stage",
  "dev",
  "test",
  "mail",
  "email",
  "smtp",
  "cdn",
  "assets",
  "static",
  "bb",
  "getbb",
  "help",
  "support",
  "billing",
  "account",
  "accounts",
  "auth",
  "login",
  "logout",
  "signup",
  "dashboard",
  "settings",
  "blog",
  "about",
  "legal",
  "privacy",
  "terms",
  "security",
  "root",
  "system",
  "internal",
  "ns1",
  "ns2",
]);

/** Per-account resource ceilings enforced at the gate (open-signup abuse guard). */
export const MAX_SERVERS_PER_ACCOUNT = 1;
export const MAX_MACHINES_PER_SERVER = 5;

/** Connect-code lifetimes. */
export const CONNECT_CODE_TTL_MS = 10 * 60 * 1000;

/** A server is shown "offline" if no heartbeat within this window. */
export const SERVER_OFFLINE_AFTER_MS = 90 * 1000;

/** Token prefixes (mirrors bb's host-key convention; distinct namespaces). */
export const CLOUD_PAT_PREFIX = "bbc_";

/**
 * Signup/sign-in allowlist while bb connect is invite-only. Parsed from the
 * `CONNECT_ALLOWED_GITHUB_USERS` worker var: comma-separated GitHub usernames,
 * case-insensitive. Unset or empty means nobody can sign in (fail closed).
 */
export function parseAllowedGithubUsers(
  value: string | undefined,
): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0),
  );
}

export function isGithubUserAllowed(
  allowed: ReadonlySet<string>,
  login: string | null | undefined,
): boolean {
  return login != null && allowed.has(login.toLowerCase());
}

export type HandleValidationError =
  | "too-short"
  | "too-long"
  | "invalid-format"
  | "reserved";

/** Returns null when `handle` is claimable, else the reason it is not. */
export function validateHandle(handle: string): HandleValidationError | null {
  if (handle.length < HANDLE_MIN_LENGTH) return "too-short";
  if (handle.length > HANDLE_MAX_LENGTH) return "too-long";
  if (!HANDLE_REGEX.test(handle)) return "invalid-format";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/** Resolve the visitor host `<handle>.<base>` to its handle, or null. */
export function handleFromHost(host: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null;
  return label.toLowerCase();
}
