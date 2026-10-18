import { z } from "zod";
import type { ConnectCredential } from "./credential.js";
import { deriveConnectBaseUrl, serverUrlForHandle } from "./urls.js";
import { ConnectListError } from "./errors.js";

const accountServerSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  live: z.boolean(),
});

const accountServersResponseSchema = z.object({
  servers: z.array(accountServerSchema),
});

type AccountServer = z.infer<typeof accountServerSchema>;

export type AccountServerWithUrl = AccountServer & {
  url: string;
};

export type ListAccountServersResult = {
  servers: AccountServerWithUrl[];
  selfHandle: string;
};

export type ConnectAccountSession = {
  serverUrl: string;
  cookie: { name: string; value: string };
};

async function fetchAccountServers(
  serverUrl: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<AccountServerWithUrl[]> {
  const url = `${serverUrl.replace(/\/$/, "")}/api/connect/servers`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConnectListError("network", message);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ConnectListError(
      "unauthorized",
      `List servers failed (${res.status}): not authorized`,
    );
  }
  if (!res.ok) {
    throw new ConnectListError(
      "network",
      `List servers failed (${res.status})`,
    );
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ConnectListError(
      "invalid_response",
      "List servers returned non-JSON",
    );
  }

  const parsed = accountServersResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConnectListError(
      "invalid_response",
      "List servers response failed schema validation",
    );
  }
  const base = deriveConnectBaseUrl(serverUrl);
  return parsed.data.servers.map((server) => ({
    ...server,
    url: serverUrlForHandle(base, server.handle),
  }));
}

export async function listAccountServers(
  credential: ConnectCredential,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ListAccountServersResult> {
  const servers = await fetchAccountServers(
    credential.serverUrl,
    { "x-bb-connect-machine": credential.credential },
    fetchImpl,
  );
  return { servers, selfHandle: credential.handle };
}

export function listAccountServersWithSession(
  session: ConnectAccountSession,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AccountServerWithUrl[]> {
  return fetchAccountServers(
    session.serverUrl,
    { cookie: `${session.cookie.name}=${session.cookie.value}` },
    fetchImpl,
  );
}
