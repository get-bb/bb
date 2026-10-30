import {
  EXPERIMENT_KEYS,
  EXPERIMENT_PATHS,
  parseForcedFlags,
  type ExperimentBootstrap,
} from "./flags";

export const FLAGS_TIMEOUT_MS = 400;
export const EXPERIMENT_CACHE_CONTROL = "private, no-cache";
const COOKIE_DAYS = 365;
const MAX_DISTINCT_ID_LENGTH = 200;
const DISTINCT_ID_PATTERN = /^[\x21-\x7e]+$/;

export type FlagsOutcome =
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
};

export type ExperimentResolution = {
  bootstrap: ExperimentBootstrap;
  setCookie: string | null;
};

type CookieRead =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "found"; distinctId: string };

export function postHogCookieName(postHogKey: string): string {
  return `ph_${postHogKey}_posthog`;
}

export function readPostHogCookie(
  cookieHeader: string | null,
  name: string,
): CookieRead {
  if (!cookieHeader) {
    return { kind: "missing" };
  }
  const prefix = `${name}=`;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (raw === undefined) {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw.slice(prefix.length)));
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

export function cookieDomain(
  hostname: string,
  baseDomain: string,
): string | null {
  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)
    ? baseDomain
    : null;
}

export function postHogCookie(args: {
  name: string;
  distinctId: string;
  url: URL;
  baseDomain: string;
  now: number;
}): string {
  const value = encodeURIComponent(
    JSON.stringify({
      distinct_id: args.distinctId,
      $device_id: args.distinctId,
      $user_state: "anonymous",
    }),
  );
  const expires = new Date(
    args.now + COOKIE_DAYS * 24 * 60 * 60 * 1000,
  ).toUTCString();
  const domain = cookieDomain(args.url.hostname, args.baseDomain);
  return [
    `${args.name}=${value}`,
    `expires=${expires}`,
    "SameSite=Lax",
    "path=/",
    ...(domain === null ? [] : [`domain=.${domain}`]),
    ...(args.url.protocol === "https:" ? ["secure"] : []),
  ].join("; ");
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

export async function evaluateFlags(
  request: FlagsRequest,
): Promise<Record<string, string>> {
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
  return outcome === "ok" ? assigned : {};
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
      typeof detail === "object" &&
      detail !== null &&
      "enabled" in detail &&
      detail.enabled === true &&
      "variant" in detail &&
      typeof detail.variant === "string" &&
      detail.variant !== ""
    ) {
      assigned[key] = detail.variant;
    }
  }
  return { outcome: "ok", assigned };
}

export async function resolveExperiments(
  request: Request,
  config: ExperimentServerConfig,
): Promise<ExperimentResolution | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !EXPERIMENT_PATHS.has(url.pathname)) {
    return null;
  }
  const forced = parseForcedFlags(url.searchParams);
  const preview = forced !== null;
  if (!config.postHogKey) {
    return preview
      ? {
          bootstrap: { distinctID: null, featureFlags: forced, preview },
          setCookie: null,
        }
      : null;
  }
  const now = config.now ?? Date.now;
  const name = postHogCookieName(config.postHogKey);
  const cookie = readPostHogCookie(request.headers.get("cookie"), name);
  if (cookie.kind === "unreadable") {
    return {
      bootstrap: { distinctID: null, featureFlags: forced ?? {}, preview },
      setCookie: null,
    };
  }
  const distinctId =
    cookie.kind === "found"
      ? cookie.distinctId
      : uuidv7(now(), (config.randomBytes ?? defaultRandomBytes)(10));
  const setCookie =
    cookie.kind === "found"
      ? null
      : postHogCookie({
          name,
          distinctId,
          url,
          baseDomain: config.baseDomain,
          now: now(),
        });
  const featureFlags =
    forced ??
    (EXPERIMENT_KEYS.length === 0
      ? {}
      : await evaluateFlags({
          host: config.postHogHost,
          apiKey: config.postHogKey,
          distinctId,
          keys: EXPERIMENT_KEYS,
          fetch: config.fetch,
          log: config.log,
          now,
          timeoutMs: config.timeoutMs ?? FLAGS_TIMEOUT_MS,
        }));
  return {
    bootstrap: { distinctID: distinctId, featureFlags, preview },
    setCookie,
  };
}

function defaultRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function withExperimentHeaders(
  response: Response,
  resolution: ExperimentResolution,
): Response {
  if (resolution.bootstrap.distinctID === null) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", EXPERIMENT_CACHE_CONTROL);
  if (resolution.setCookie !== null) {
    headers.append("set-cookie", resolution.setCookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
