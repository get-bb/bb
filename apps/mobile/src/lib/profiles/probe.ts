import { z } from "zod";
import { MOBILE_APP_SURFACE_HEADER } from "../sdk/app-surface";
import { isLoopbackHost } from "./direct-url";

export type ProbeStage = "health" | "config" | "sign-in";

export type ProbeServerResult =
  | {
      ok: true;
      serverUrl: string;
      advertisedServerUrl: string | null;
    }
  | { ok: false; serverUrl: string; stage: ProbeStage; error: string };

const probeConfigSchema = z.object({
  serverUrl: z.string(),
  primaryHostId: z.string().nullable(),
});

const healthSchema = z.object({ ok: z.literal(true) });

const signInRequiredSchema = z.object({
  code: z.enum([
    "unauthenticated",
    "credential_requires_https",
    "invalid_dpop_proof",
    "access_token_expired",
  ]),
});

export type ProbeFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const DEFAULT_PROBE_TIMEOUT_MS = 8000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "Timed out";
    }
    return error.message;
  }
  return String(error);
}

type GetJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; error: string; status: number | null; body: unknown };

async function getJson(
  fetchImpl: ProbeFetch,
  url: string,
  timeoutMs: number,
): Promise<GetJsonResult> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        [MOBILE_APP_SURFACE_HEADER.name]: MOBILE_APP_SURFACE_HEADER.value,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {}
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        body,
      };
    }
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return {
        ok: false,
        error: "Response was not JSON",
        status: response.status,
        body: null,
      };
    }
  } catch (error) {
    return { ok: false, error: describeError(error), status: null, body: null };
  }
}

export async function probeServer(
  serverUrl: string,
  fetchImpl: ProbeFetch,
): Promise<ProbeServerResult> {
  const base = serverUrl.replace(/\/+$/u, "");

  const health = await getJson(
    fetchImpl,
    `${base}/health`,
    DEFAULT_PROBE_TIMEOUT_MS,
  );
  if (!health.ok) {
    return { ok: false, serverUrl: base, stage: "health", error: health.error };
  }
  if (!healthSchema.safeParse(health.body).success) {
    return {
      ok: false,
      serverUrl: base,
      stage: "health",
      error: "Not a bb server (unexpected /health response)",
    };
  }

  const config = await getJson(
    fetchImpl,
    `${base}/api/v1/system/config`,
    DEFAULT_PROBE_TIMEOUT_MS,
  );
  if (!config.ok) {
    const signIn = signInRequiredSchema.safeParse(config.body);
    if (config.status === 401 && signIn.success) {
      return {
        ok: false,
        serverUrl: base,
        stage: "sign-in",
        error:
          signIn.data.code === "credential_requires_https"
            ? "This phone's sign-in was made over HTTPS. Use the HTTPS address or sign in again."
            : "This bb needs a sign-in code.",
      };
    }
    return { ok: false, serverUrl: base, stage: "config", error: config.error };
  }
  const parsed = probeConfigSchema.safeParse(config.body);
  if (!parsed.success) {
    return {
      ok: false,
      serverUrl: base,
      stage: "config",
      error: "Not a bb server (unexpected /system/config response)",
    };
  }

  return {
    ok: true,
    serverUrl: base,
    advertisedServerUrl: advertisedServerUrl(base, parsed.data.serverUrl),
  };
}

function advertisedServerUrl(entered: string, reported: string): string | null {
  let reportedUrl: URL;
  try {
    reportedUrl = new URL(reported);
  } catch {
    return null;
  }
  if (isLoopbackHost(reportedUrl.hostname)) return null;
  const normalized = reported.replace(/\/+$/u, "");
  return normalized === entered ? null : normalized;
}
