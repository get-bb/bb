import {
  GATE_FAST_OFFLINE_HEADER,
  GATE_FORWARDED_AUTH_HEADER,
  GATE_FORWARDED_HOST_HEADER,
  GATE_OFFLINE_HEADER,
} from "@bb/tunnel-contract/next";
import { stripCloudDevHeader } from "./cloud-dev.js";
import type { GateProgress } from "./gate-deadline.js";

export const NEXT_REPLAY_BODY_MAX_BYTES = 1024 * 1024;

const GATE_FORWARD_HEADERS = [
  GATE_FORWARDED_HOST_HEADER,
  GATE_FORWARDED_AUTH_HEADER,
  GATE_FAST_OFFLINE_HEADER,
  GATE_OFFLINE_HEADER,
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504]);

export function withoutGateForwardHeaders(request: Request): Request {
  if (!GATE_FORWARD_HEADERS.some((name) => request.headers.has(name))) {
    return request;
  }
  const headers = new Headers(request.headers);
  for (const name of GATE_FORWARD_HEADERS) headers.delete(name);
  return new Request(request, { headers });
}

export type FlyFallbackReason = "gate-offline" | "fly-error" | "fly-5xx";

export type FlyAttempt =
  | { kind: "served"; response: Response; unreplayedOffline: boolean }
  | { kind: "failed"; error: unknown }
  | {
      kind: "fallback";
      reason: FlyFallbackReason;
      replay: Request;
      flyResponse: Response | null;
    };

interface ForwardToFlyArgs {
  request: Request;
  url: URL;
  host: string;
  subdomain: string;
  nextBaseDomain: string;
  gateSecret: string;
  progress: GateProgress;
  signal: AbortSignal;
}

function replayableBodyLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d+$/u.test(raw)) return null;
  const length = Number(raw);
  return length <= NEXT_REPLAY_BODY_MAX_BYTES ? length : null;
}

function isGateOffline(response: Response): boolean {
  return (
    response.status === 503 && response.headers.get(GATE_OFFLINE_HEADER) === "1"
  );
}

function nextGateUrl(
  url: URL,
  subdomain: string,
  nextBaseDomain: string,
): URL {
  return new URL(
    `${url.pathname}${url.search}`,
    `https://${subdomain}.${nextBaseDomain}`,
  );
}

export async function forwardToFly({
  request,
  url,
  host,
  subdomain,
  nextBaseDomain,
  gateSecret,
  progress,
  signal,
}: ForwardToFlyArgs): Promise<FlyAttempt> {
  let body: ReadableStream | ArrayBuffer | null = request.body;
  let replay: Request | null = request.body === null ? request : null;
  if (request.body !== null && replayableBodyLength(request) !== null) {
    progress.stage = "request-body";
    const buffered = await request.arrayBuffer();
    body = buffered;
    replay = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: buffered,
      redirect: "manual",
    });
  }
  const retrySafe = replay !== null && SAFE_METHODS.has(request.method);

  const headers = new Headers(request.headers);
  headers.delete("host");
  stripCloudDevHeader(headers);
  headers.set(GATE_FORWARDED_HOST_HEADER, host);
  headers.set(GATE_FORWARDED_AUTH_HEADER, `Bearer ${gateSecret}`);
  headers.set(GATE_FAST_OFFLINE_HEADER, "1");

  progress.upstream = "fly-gate";
  progress.stage = "response-head";
  let response: Response;
  try {
    response = await fetch(nextGateUrl(url, subdomain, nextBaseDomain), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (retrySafe && replay !== null) {
      return {
        kind: "fallback",
        reason: "fly-error",
        replay,
        flyResponse: null,
      };
    }
    return { kind: "failed", error };
  }
  progress.stage = "finishing";

  const offline = isGateOffline(response);
  if (offline && replay !== null) {
    void response.body?.cancel().catch(() => {});
    return {
      kind: "fallback",
      reason: "gate-offline",
      replay,
      flyResponse: null,
    };
  }
  if (
    retrySafe &&
    replay !== null &&
    GATEWAY_ERROR_STATUSES.has(response.status)
  ) {
    return {
      kind: "fallback",
      reason: "fly-5xx",
      replay,
      flyResponse: response,
    };
  }
  return { kind: "served", response, unreplayedOffline: offline };
}
