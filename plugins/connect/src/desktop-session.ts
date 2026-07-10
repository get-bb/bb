import { z } from "zod";
import type { ConnectCredential } from "./credential.js";
import { ConnectListError } from "./list-servers.js";

const desktopSessionResponseSchema = z.object({
  cookie: z.object({
    domain: z.string().min(1),
    expiresAt: z.number().int().positive(),
    name: z.string().min(1),
    value: z.string().min(1),
  }),
});

export type DesktopSession = z.infer<typeof desktopSessionResponseSchema>;

export async function fetchDesktopSession(
  credential: ConnectCredential,
): Promise<DesktopSession> {
  const url = `${credential.serverUrl.replace(/\/$/, "")}/api/connect/desktop-session`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "x-bb-connect-machine": credential.credential },
    });
  } catch (error) {
    throw new ConnectListError(
      "network",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ConnectListError(
      "unauthorized",
      "Desktop session not authorized",
    );
  }
  if (!response.ok) {
    throw new ConnectListError(
      "network",
      `Desktop session failed (${response.status})`,
    );
  }
  const parsed = desktopSessionResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ConnectListError(
      "invalid_response",
      "Desktop session response failed schema validation",
    );
  }
  return parsed.data;
}
