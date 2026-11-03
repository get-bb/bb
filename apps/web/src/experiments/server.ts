import {
  EXPERIMENT_KEYS,
  EXPERIMENT_PATHS,
  SITE_WIDE_EXPERIMENTS,
  isExperimentKey,
  isKnownVariant,
  parseForcedFlags,
  type ExperimentBootstrap,
  type ExperimentKey,
} from "./flags";

const FLAGS_TIMEOUT_MS = 400;
export const EXPERIMENT_CACHE_CONTROL = "private, no-cache";
export const ASSIGNMENT_COOKIE_NAME = "__Host-bb_experiments";
const COOKIE_DAYS = 365;
const ASSIGNMENT_COOKIE_MS = 24 * 60 * 60 * 1000;
const UNASSIGNED_TTL_MS = 60 * 60 * 1000;
const STAMP = "~";
const AUTOMATED_USER_AGENT =
  /bot|crawl|spider|slurp|preview|monitor|uptime|pingdom|statuscake|headless|lighthouse|curl|wget|python|httpclient|go-http|axios|node-fetch|okhttp|java\/|^node\b/i;
const NON_PAGE_ROOTS = [
  "/api",
  "/oauth",
  "/.well-known",
  "/dashboard",
  "/link",
  "/marketplace/v1",
  "/marketplace/v2",
  "/marketplace/og",
];
const MAX_ASSIGNMENT_COOKIE_LENGTH = 1024;
const MAX_DISTINCT_ID_LENGTH = 200;
const DISTINCT_ID_PATTERN = /^[\x21-\x7e]+$/;

type FlagsOutcome =
  | "ok"
  | "timeout"
  | "error"
  | "http_error"
  | "invalid_response"
  | "quota_limited"
  | "errors_while_computing";

export type FlagsLogEntry = {
  event: "posthog_flags";
  outcome: FlagsOutcome;
  duration_ms: number;
  status?: number;
  assigned: number;
};

export type ExperimentServerConfig = {
  postHogKey: string | undefined;
  postHogHost: string;
  baseDomain: string;
  fetch: typeof fetch;
  log: (entry: FlagsLogEntry) => void;
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  timeoutMs?: number;
  siteWideKeys?: readonly ExperimentKey[];
};

type ExperimentResolution = {
  bootstrap: ExperimentBootstrap;
  setCookies: readonly string[];
};

type CookieRead =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "found"; distinctId: string };

function postHogCookieName(postHogKey: string): string {
  return `ph_${postHogKey}_posthog`;
}

function readCookieValue(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  const prefix = `${name}=`;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return raw === undefined ? null : raw.slice(prefix.length);
}

export function readPostHogCookie(
  cookieHeader: string | null,
  name: string,
): CookieRead {
  const raw = readCookieValue(cookieHeader, name);
  if (raw === null) {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return { kind: "unreadable" };
  }
  const distinctId =
    typeof parsed === "object" && parsed !== null && "distinct_id" in parsed
      ? parsed.distinct_id
      : null;
  return typeof distinctId === "string" &&
    distinctId.length <= MAX_DISTINCT_ID_LENGTH &&
    DISTINCT_ID_PATTERN.test(distinctId)
    ? { kind: "found", distinctId }
    : { kind: "unreadable" };
}

export function uuidv7(now: number, random: Uint8Array): string {
  const bytes = new Uint8Array(16);
  let timestamp = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cookieDomain(
  hostname: string,
  baseDomain: string,
): string | null {
  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)
    ? baseDomain
    : null;
}

type CookieTarget = {
  url: URL;
  baseDomain: string;
  now: number;
};

function setCookieHeader(
  name: string,
  value: string,
  expiresAt: number,
  target: CookieTarget,
): string {
  const domain = cookieDomain(target.url.hostname, target.baseDomain);
  return [
    `${name}=${value}`,
    `expires=${new Date(expiresAt).toUTCString()}`,
    "SameSite=Lax",
    "path=/",
    ...(domain === null ? [] : [`domain=.${domain}`]),
    ...(target.url.protocol === "https:" ? ["secure"] : []),
  ].join("; ");
}

function cookieExpiry(now: number): number {
  return now + COOKIE_DAYS * 24 * 60 * 60 * 1000;
}

function postHogCookie(
  args: CookieTarget & { name: string; distinctId: string },
): string {
  const value = encodeURIComponent(
    JSON.stringify({
      distinct_id: args.distinctId,
      $device_id: args.distinctId,
      $user_state: "anonymous",
    }),
  );
  return setCookieHeader(args.name, value, cookieExpiry(args.now), args);
}

type FlagsRequest = {
  host: string;
  apiKey: string;
  distinctId: string;
  keys: readonly string[];
  fetch: typeof fetch;
  log: (entry: FlagsLogEntry) => void;
  now: () => number;
  timeoutMs: number;
};

type FlagsEvaluation = {
  outcome: FlagsOutcome;
  flags: Record<string, string>;
};

export async function evaluateFlags(
  request: FlagsRequest,
): Promise<FlagsEvaluation> {
  const startedAt = request.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  let outcome: FlagsOutcome = "error";
  let status: number | undefined;
  let assigned: Record<string, string> = {};
  try {
    const response = await request.fetch(
      `${request.host.replace(/\/$/, "")}/flags/?v=2`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: request.apiKey,
          distinct_id: request.distinctId,
          flag_keys_to_evaluate: request.keys,
          geoip_disable: true,
        }),
        signal: controller.signal,
      },
    );
    status = response.status;
    if (!response.ok) {
      outcome = "http_error";
    } else {
      const body: unknown = await response.json();
      ({ outcome, assigned } = readFlagsBody(body, request.keys));
    }
  } catch {
    outcome = controller.signal.aborted ? "timeout" : "error";
  } finally {
    clearTimeout(timer);
  }
  request.log({
    event: "posthog_flags",
    outcome,
    duration_ms: request.now() - startedAt,
    ...(status === undefined ? {} : { status }),
    assigned: Object.keys(assigned).length,
  });
  return { outcome, flags: outcome === "ok" ? assigned : {} };
}

function readFlagsBody(
  body: unknown,
  keys: readonly string[],
): { outcome: FlagsOutcome; assigned: Record<string, string> } {
  if (typeof body !== "object" || body === null) {
    return { outcome: "invalid_response", assigned: {} };
  }
  if (
    "quotaLimited" in body &&
    Array.isArray(body.quotaLimited) &&
    body.quotaLimited.includes("feature_flags")
  ) {
    return { outcome: "quota_limited", assigned: {} };
  }
  if (
    "errorsWhileComputingFlags" in body &&
    body.errorsWhileComputingFlags === true
  ) {
    return { outcome: "errors_while_computing", assigned: {} };
  }
  if (
    !("flags" in body) ||
    typeof body.flags !== "object" ||
    body.flags === null
  ) {
    return { outcome: "invalid_response", assigned: {} };
  }
  const flags: Record<string, unknown> = { ...body.flags };
  const assigned: Record<string, string> = {};
  for (const key of keys) {
    const detail = flags[key];
    if (
      isExperimentKey(key) &&
      typeof detail === "object" &&
      detail !== null &&
      "enabled" in detail &&
      detail.enabled === true &&
      "variant" in detail &&
      typeof detail.variant === "string" &&
      isKnownVariant(key, detail.variant)
    ) {
      assigned[key] = detail.variant;
    }
  }
  return { outcome: "ok", assigned };
}

function isSitePage(request: Request, url: URL): boolean {
  if (EXPERIMENT_PATHS.has(url.pathname)) {
    return true;
  }
  const path = url.pathname;
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  return (
    (request.headers.get("accept") ?? "").includes("text/html") &&
    !path.startsWith("/download/") &&
    !lastSegment.includes(".") &&
    !NON_PAGE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
  );
}

export function isAutomatedClient(request: Request): boolean {
  const userAgent = request.headers.get("user-agent") ?? "";
  return userAgent === "" || AUTOMATED_USER_AGENT.test(userAgent);
}

type StoredAssignments = Readonly<
  Record<string, { variant: string | null; value: string }>
>;

export function readAssignmentCookie(
  cookieHeader: string | null,
  keys: readonly ExperimentKey[],
  now: number,
): StoredAssignments {
  const raw = readCookieValue(cookieHeader, ASSIGNMENT_COOKIE_NAME);
  if (raw === null || raw.length > MAX_ASSIGNMENT_COOKIE_LENGTH) {
    return {};
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(decodeURIComponent(raw));
  } catch {
    return {};
  }
  const stored: Record<string, { variant: string | null; value: string }> =
    {};
  for (const [key, value] of params) {
    const stamp = value.indexOf(STAMP);
    if (!isExperimentKey(key) || !keys.includes(key) || stamp < 0) {
      continue;
    }
    const variant = value.slice(0, stamp);
    const storedAt = Number(value.slice(stamp + STAMP.length));
    const ttl = variant === "" ? UNASSIGNED_TTL_MS : ASSIGNMENT_COOKIE_MS;
    if (
      storedAt <= now &&
      now - storedAt < ttl &&
      (variant === "" || isKnownVariant(key, variant))
    ) {
      stored[key] = { variant: variant === "" ? null : variant, value };
    }
  }
  return stored;
}

function assignmentCookie(
  assignments: Readonly<Record<string, string>>,
  now: number,
): string {
  const value = new URLSearchParams(
    Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return [
    `${ASSIGNMENT_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `expires=${new Date(now + ASSIGNMENT_COOKIE_MS).toUTCString()}`,
    "SameSite=Lax",
    "Path=/",
    "Secure",
  ].join("; ");
}

export async function resolveExperiments(
  request: Request,
  config: ExperimentServerConfig,
): Promise<ExperimentResolution | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !isSitePage(request, url)) {
    return null;
  }
  const siteWideKeys = config.siteWideKeys ?? SITE_WIDE_EXPERIMENTS;
  const keys = EXPERIMENT_PATHS.has(url.pathname)
    ? EXPERIMENT_KEYS
    : siteWideKeys;
  const forced = parseForcedFlags(url.searchParams);
  const preview = forced !== null;
  if (keys.length === 0 && !preview) {
    return null;
  }
  if (!config.postHogKey || isAutomatedClient(request)) {
    return preview
      ? {
          bootstrap: { distinctID: null, featureFlags: forced, preview },
          setCookies: [],
        }
      : null;
  }
  const now = config.now ?? Date.now;
  const cookieHeader = request.headers.get("cookie");
  const name = postHogCookieName(config.postHogKey);
  const cookie = readPostHogCookie(cookieHeader, name);
  if (cookie.kind === "unreadable") {
    return {
      bootstrap: { distinctID: null, featureFlags: forced ?? {}, preview },
      setCookies: [],
    };
  }
  const distinctId =
    cookie.kind === "found"
      ? cookie.distinctId
      : uuidv7(now(), (config.randomBytes ?? defaultRandomBytes)(10));
  const target = { url, baseDomain: config.baseDomain, now: now() };
  const setCookies =
    cookie.kind === "found"
      ? []
      : [postHogCookie({ name, distinctId, ...target })];
  if (forced !== null) {
    return {
      bootstrap: { distinctID: distinctId, featureFlags: forced, preview },
      setCookies,
    };
  }
  const stored = readAssignmentCookie(cookieHeader, EXPERIMENT_KEYS, now());
  const missing = keys.filter((key) => !Object.hasOwn(stored, key));
  const evaluation =
    missing.length === 0
      ? null
      : await evaluateFlags({
          host: config.postHogHost,
          apiKey: config.postHogKey,
          distinctId,
          keys: missing,
          fetch: config.fetch,
          log: config.log,
          now,
          timeoutMs: config.timeoutMs ?? FLAGS_TIMEOUT_MS,
        });
  const featureFlags: Record<string, string> = {};
  for (const key of keys) {
    const variant = Object.hasOwn(stored, key)
      ? stored[key]?.variant
      : evaluation?.flags[key];
    if (variant) {
      featureFlags[key] = variant;
    }
  }
  if (evaluation?.outcome === "ok") {
    const checkedAt = now();
    const values: Record<string, string> = {};
    for (const [key, entry] of Object.entries(stored)) {
      values[key] = entry.value;
    }
    for (const key of missing) {
      values[key] = `${evaluation.flags[key] ?? ""}${STAMP}${checkedAt}`;
    }
    setCookies.push(assignmentCookie(values, checkedAt));
  }
  return {
    bootstrap: { distinctID: distinctId, featureFlags, preview },
    setCookies,
  };
}

function defaultRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

export function withExperimentHeaders(
  response: Response,
  resolution: ExperimentResolution | null,
): Response {
  const personalized =
    resolution !== null &&
    (resolution.bootstrap.distinctID !== null ||
      Object.keys(resolution.bootstrap.featureFlags).length > 0 ||
      resolution.setCookies.length > 0);
  const html = isHtml(response);
  if (!html && !personalized) {
    return response;
  }
  const headers = new Headers(response.headers);
  if (html) {
    headers.append("vary", "Cookie");
  }
  if (personalized) {
    headers.set("cache-control", EXPERIMENT_CACHE_CONTROL);
  }
  for (const cookie of resolution?.setCookies ?? []) {
    headers.append("set-cookie", cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
