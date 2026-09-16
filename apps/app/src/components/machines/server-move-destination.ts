import {
  serverHealthResponseSchema,
  type ServerMoveHealth,
} from "@bb/host-daemon-contract";

export async function fetchServerMoveDestinationHealth(
  url: string,
  signal: AbortSignal,
): Promise<ServerMoveHealth | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = serverHealthResponseSchema.safeParse(await response.json());
    return parsed.success ? (parsed.data.serverMove ?? null) : null;
  } catch {
    return null;
  }
}
