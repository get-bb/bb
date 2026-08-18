// bb connect cloud policy constants. Single source of truth — the worker, the
// dashboard, and migrations reference these rather than scattering literals.

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
  // Core product and routing.
  "www",
  // `default` collides with the primary server's row name on (user_id, name).
  "default",
  "api",
  "app",
  "bb",
  "connect",
  "dashboard",
  "getbb",

  // Public website and company properties.
  "about",
  "blog",
  "careers",
  "changelog",
  "community",
  "doc",
  "docs",
  "download",
  "downloads",
  "feedback",
  "forum",
  "help",
  "jobs",
  "legal",
  "pricing",
  "privacy",
  "roadmap",
  "status",
  "support",
  "terms",

  // Identity, account, billing, and trust surfaces.
  "abuse",
  "account",
  "accounts",
  "admin",
  "auth",
  "billing",
  "login",
  "logout",
  "oauth",
  "password",
  "register",
  "reset",
  "security",
  "settings",
  "signin",
  "signout",
  "signup",
  "sso",
  "trust",
  "verify",

  // Network, delivery, and storage infrastructure.
  "assets",
  "cdn",
  "dns",
  "edge",
  "email",
  "files",
  "ftp",
  "gateway",
  "git",
  "images",
  "imap",
  "internal",
  "mail",
  "media",
  "mx",
  "ns1",
  "ns2",
  "origin",
  "pop",
  "proxy",
  "relay",
  "root",
  "smtp",
  "static",
  "system",
  "tunnel",
  "upload",
  "uploads",
  "websocket",
  "ws",

  // Deployment and release channels.
  "alpha",
  "beta",
  "canary",
  "demo",
  "dev",
  "preview",
  "prod",
  "production",
  "stage",
  "staging",
  "test",
]);

/**
 * Per-account resource ceiling enforced at the gate (open-signup abuse guard).
 * Servers and machines each count separately against this one limit: an
 * account can own up to 20 servers and, independently, up to 20 machines.
 */
export const MAX_PER_ACCOUNT = 20;

/** Connect-code lifetimes. */
export const CONNECT_CODE_TTL_MS = 10 * 60 * 1000;

/** A server is shown "offline" if no heartbeat within this window. */
export const SERVER_OFFLINE_AFTER_MS = 90 * 1000;

/** Token prefixes (mirrors bb's host-key convention; distinct namespaces). */
export const CLOUD_PAT_PREFIX = "bbc_";

export type HandleValidationError =
  | "too-short"
  | "too-long"
  | "invalid-format"
  | "reserved";

/** Returns null when `handle` is claimable, else the reason it is not. */
export function validateHandle(handle: string): HandleValidationError | null {
  if (handle.length < HANDLE_MIN_LENGTH) return "too-short";
  if (handle.length > HANDLE_MAX_LENGTH) return "too-long";
  // `--` is reserved as the host-label separator for port shares
  // (`<handle>--<port>.<base>`). Never allow it in claimable handles.
  if (handle.includes("--")) return "invalid-format";
  if (!HANDLE_REGEX.test(handle)) return "invalid-format";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/**
 * Account handles, server subdomains, and machine subdomains live in ONE public
 * namespace and share the exact same grammar, so every claim path validates
 * through a single function. `validateLabel` is the intent-neutral canonical name;
 * `validateHandle` / `validateSubdomain` are the same function under
 * domain-specific names so the two claim paths cannot drift apart.
 */
export const validateLabel = validateHandle;
export const validateSubdomain = validateHandle;

/** Alias of {@link HandleValidationError}; the two namespaces share one grammar. */
export type LabelValidationError = HandleValidationError;
export type SubdomainValidationError = HandleValidationError;

/** Decimal port 1–65535 with no leading zeros (v1 share target grammar). */
const SHARE_PORT_TARGET = /^[1-9]\d{0,4}$/;

function isValidShareTarget(target: string): boolean {
  if (!SHARE_PORT_TARGET.test(target)) return false;
  const port = Number(target);
  return port >= 1 && port <= 65535;
}

export interface VisitorHost {
  handle: string;
  /** Null on a bare handle host; a decimal port string on a share host. */
  target: string | null;
}

/**
 * Resolve a visitor host to its handle and optional share target.
 *
 * - `<handle>.<base>` → `{ handle, target: null }`
 * - `<handle>--<port>.<base>` → `{ handle, target: port }` when port is a
 *   valid decimal 1–65535 with no leading zeros
 * - apex, multi-level labels, foreign domains, or invalid share labels → null
 *
 * When the label contains `--`, it is split on the first occurrence only
 * (prefix = handle, suffix = target). An invalid target makes the whole
 * host unroutable (null), not a bare-handle fallback.
 */
export function parseVisitorHost(
  host: string,
  baseDomain: string,
): VisitorHost | null {
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null;

  const sep = label.indexOf("--");
  if (sep === -1) {
    return { handle: label.toLowerCase(), target: null };
  }

  const handle = label.slice(0, sep).toLowerCase();
  const target = label.slice(sep + 2);
  if (!handle || !isValidShareTarget(target)) return null;
  return { handle, target };
}
