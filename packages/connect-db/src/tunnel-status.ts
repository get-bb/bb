export const TUNNEL_STATUS_URL = "https://tunnel/__control/status";
export const TUNNEL_STATUS_HEADER = "x-bb-tunnel-status";

export type TunnelConnectedLookup = (
  routingKey: string,
) => Promise<boolean | null>;

interface TunnelStatusNamespace<Id> {
  idFromName(name: string): Id;
  get(id: Id): { fetch(url: string): Promise<Response> };
}

export function presenceWritesOnChange(env: {
  PRESENCE_WRITES?: string;
}): boolean {
  return env.PRESENCE_WRITES?.trim() === "on-change";
}

export async function readTunnelConnected<Id>(
  namespace: TunnelStatusNamespace<Id>,
  routingKey: string,
): Promise<boolean | null> {
  try {
    const response = await namespace
      .get(namespace.idFromName(routingKey))
      .fetch(TUNNEL_STATUS_URL);
    if (!response.ok || response.headers.get(TUNNEL_STATUS_HEADER) !== "1") {
      return null;
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const connected: unknown = Reflect.get(body, "connected");
    return typeof connected === "boolean" ? connected : null;
  } catch {
    return null;
  }
}

export function tunnelConnectedLookup<Id>(
  env: { PRESENCE_WRITES?: string },
  namespace: TunnelStatusNamespace<Id>,
): TunnelConnectedLookup | null {
  return presenceWritesOnChange(env)
    ? (routingKey) => readTunnelConnected(namespace, routingKey)
    : null;
}

export function isLive(args: {
  lastSeenMs: number | null;
  now: number;
  offlineAfterMs: number;
  tunnelConnected: boolean | null;
}): boolean {
  if (args.tunnelConnected !== null) return args.tunnelConnected;
  return (
    args.lastSeenMs !== null && args.now - args.lastSeenMs < args.offlineAfterMs
  );
}
