import { z } from "zod";

export const SERVER_ROUTE_PROBE_TIMEOUT_MS = 2_000;
export const SERVER_ROUTE_HEAD_START_MS = 500;

export function serverRouteKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/u, "")}`;
}

export function orderServerRoutes<TRoute extends { url: string }>(
  learned: readonly TRoute[],
  anchors: readonly TRoute[],
): TRoute[] {
  const keys = new Set<string>();
  const ordered: TRoute[] = [];
  for (const route of [...learned, ...anchors]) {
    const key = serverRouteKey(route.url);
    if (keys.has(key)) continue;
    keys.add(key);
    ordered.push(route);
  }
  return ordered;
}

export type ServerRouteFetch = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

export type ServerRouteProbeResult =
  | { kind: "answered"; serverId: string | null }
  | { kind: "different-server"; serverId: string | null }
  | { kind: "unreachable"; reason: string };

export interface ProbeServerRouteArgs {
  url: string;
  headers: Record<string, string>;
  expectedServerId: string | null;
  fetchFn: ServerRouteFetch;
  signal: AbortSignal;
}

const healthResponseSchema = z
  .object({ ok: z.literal(true), serverId: z.string().min(1).optional() })
  .passthrough();

function errorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError"
      ? "did not answer within 2 seconds"
      : error.message;
  }
  return String(error);
}

export async function probeServerRoute(
  args: ProbeServerRouteArgs,
): Promise<ServerRouteProbeResult> {
  try {
    const response = await args.fetchFn(new URL("/health", args.url), {
      headers: args.headers,
      redirect: "error",
      signal: AbortSignal.any([
        args.signal,
        AbortSignal.timeout(SERVER_ROUTE_PROBE_TIMEOUT_MS),
      ]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: "unreachable",
        reason: `/health returned HTTP ${response.status}`,
      };
    }
    const health = healthResponseSchema.safeParse(await response.json());
    if (!health.success) {
      return { kind: "unreachable", reason: "/health is not a bb server" };
    }
    const serverId = health.data.serverId ?? null;
    if (args.expectedServerId !== null && serverId !== args.expectedServerId) {
      return { kind: "different-server", serverId };
    }
    return { kind: "answered", serverId };
  } catch (error) {
    return { kind: "unreachable", reason: errorReason(error) };
  }
}

export function selectServerRoute<TRoute>(
  candidates: readonly TRoute[],
  probe: (candidate: TRoute, signal: AbortSignal) => Promise<boolean>,
): Promise<TRoute | null> {
  if (candidates.length === 0) return Promise.resolve(null);
  const controller = new AbortController();
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const failed = candidates.map(() => false);
    let settled = false;
    let best: { rank: number; timer: ReturnType<typeof setTimeout> } | null =
      null;
    const finish = (winner: TRoute | null) => {
      if (settled) return;
      settled = true;
      if (best !== null) clearTimeout(best.timer);
      controller.abort();
      resolve(winner);
    };
    const betterRanksFailed = (rank: number) =>
      failed.slice(0, rank).every(Boolean);
    const settleIfDecided = () => {
      if (failed.every(Boolean)) {
        finish(null);
        return;
      }
      if (best !== null && betterRanksFailed(best.rank)) {
        finish(candidates[best.rank] ?? null);
      }
    };
    candidates.forEach((candidate, rank) => {
      void probe(candidate, controller.signal)
        .catch(() => false)
        .then((answered) => {
          if (settled) return;
          if (!answered) {
            failed[rank] = true;
            settleIfDecided();
            return;
          }
          const wait =
            rank * SERVER_ROUTE_HEAD_START_MS - (Date.now() - startedAt);
          if (wait <= 0 || betterRanksFailed(rank)) {
            finish(candidate);
            return;
          }
          if (best !== null && best.rank < rank) return;
          if (best !== null) clearTimeout(best.timer);
          best = { rank, timer: setTimeout(() => finish(candidate), wait) };
        });
    });
  });
}
