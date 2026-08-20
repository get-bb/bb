import { z } from "zod";

// Only the field the stranded-daemon rules need; the route also reports the
// bb-app version, which `GET /system/version` already covers.
const installVersionSchema = z.object({
  protocolVersion: z.number().int(),
});

/**
 * The connected server's `HOST_DAEMON_PROTOCOL_VERSION` from
 * `GET /install/version` (the same route the daemon's self-update reads).
 * The phone ships on its own schedule, so the constant compiled into this app
 * says nothing about the server it is talking to; only this value may be
 * compared with a host's `lastRejectedProtocolVersion`. Goes through the
 * profile's fetch (app-surface header, auth reporting, the native cookie jar).
 */
export async function fetchServerProtocolVersion(
  client: { serverUrl: string; fetch: typeof fetch },
  signal?: AbortSignal,
): Promise<number> {
  const base = client.serverUrl.replace(/\/+$/u, "");
  const response = await client.fetch(`${base}/install/version`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `GET /install/version failed with status ${response.status}`,
    );
  }
  return installVersionSchema.parse(await response.json()).protocolVersion;
}
