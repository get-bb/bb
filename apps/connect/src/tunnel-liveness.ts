import { TUNNEL_STATUS_HEADER, TUNNEL_STATUS_URL } from "@bb/connect-db";

export type TunnelLiveness =
  | { state: "connected"; lastHeartbeatAgeMs: number | null }
  | { state: "disconnected" }
  | { state: "unknown" };

const UNKNOWN: TunnelLiveness = { state: "unknown" };

async function fetchTunnelLiveness(
  namespace: DurableObjectNamespace,
  routingKey: string,
): Promise<TunnelLiveness> {
  const response = await namespace
    .get(namespace.idFromName(routingKey))
    .fetch(TUNNEL_STATUS_URL);
  if (!response.ok || response.headers.get(TUNNEL_STATUS_HEADER) !== "1") {
    return UNKNOWN;
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null) return UNKNOWN;
  const connected: unknown = Reflect.get(body, "connected");
  if (connected === false) return { state: "disconnected" };
  if (connected !== true) return UNKNOWN;
  const age: unknown = Reflect.get(body, "lastHeartbeatAgeMs");
  return {
    state: "connected",
    lastHeartbeatAgeMs: typeof age === "number" ? age : null,
  };
}

export async function readTunnelLiveness(
  namespace: DurableObjectNamespace,
  routingKey: string,
  timeoutMs: number,
): Promise<TunnelLiveness> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<TunnelLiveness>((resolve) => {
    timer = setTimeout(() => resolve(UNKNOWN), timeoutMs);
  });
  try {
    return await Promise.race([
      fetchTunnelLiveness(namespace, routingKey).catch(() => UNKNOWN),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
