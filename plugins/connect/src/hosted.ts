import { z } from "zod";
import {
  ConnectListError,
  serverUrlForHandle,
  type DesktopSession,
  type ListAccountServersResult,
} from "@bb/connect-client";
import {
  AccountUnavailableError,
  type AccountClient,
  type AccountFetchRequest,
  type AccountFetchResult,
} from "./account-client.js";
import { MachineCodeError, type MachineCode } from "./machine-code.js";

export class NotSignedInError extends Error {
  constructor() {
    super("this bb isn't signed in to a bb account");
    this.name = "NotSignedInError";
  }
}

const signedOutBodySchema = z.object({ error: z.literal("signed-out") });

const ticketResponseSchema = z.object({
  ticket: z.string().min(1),
  tunnelUrl: z.string().url(),
  expiresAt: z.number(),
});

export type TunnelTicket = z.infer<typeof ticketResponseSchema>;

const accountServersResponseSchema = z.object({
  servers: z.array(
    z.object({
      handle: z.string().min(1),
      name: z.string().min(1),
      live: z.boolean(),
    }),
  ),
});

const desktopSessionResponseSchema = z.object({
  cookie: z.object({
    domain: z.string().min(1),
    expiresAt: z.number().int().positive(),
    name: z.string().min(1),
    value: z.string().min(1),
  }),
});

const machineCodeResponseSchema = z.object({
  code: z.string().min(1),
  expiresInMs: z.number().int().positive(),
  serverUrl: z.string().url(),
});

const machineCodeLookupSchema = z.object({
  consumed: z.boolean(),
  machineId: z.string().nullable(),
});

const revokeMachineResponseSchema = z.object({ ok: z.literal(true) });

export interface AccountServerIdentity {
  baseUrl: string;
  handle: string;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined) {
  if (signal === undefined) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class HostedConnectApi {
  constructor(private readonly account: AccountClient) {}

  async mintTunnelTicket(): Promise<TunnelTicket> {
    const result = await this.send({
      target: "api",
      method: "POST",
      path: "/api/connect/tunnel-ticket",
      body: null,
    });
    if (result.status === 401) throw new NotSignedInError();
    if (result.status < 200 || result.status >= 300) {
      throw new Error(
        `getbb.app returned HTTP ${result.status} for a tunnel ticket`,
      );
    }
    const parsed = ticketResponseSchema.safeParse(result.body);
    if (!parsed.success) {
      throw new Error(
        "getbb.app returned a tunnel ticket bb doesn't understand",
      );
    }
    return parsed.data;
  }

  async listAccountServers(
    identity: AccountServerIdentity,
  ): Promise<ListAccountServersResult> {
    const result = await this.sendListing({
      target: "gate",
      method: "GET",
      path: "/api/connect/servers",
      body: null,
    });
    if (result.status === 401 || result.status === 403) {
      throw new ConnectListError(
        "unauthorized",
        `List servers failed (${result.status}): not authorized`,
      );
    }
    if (result.status < 200 || result.status >= 300) {
      throw new ConnectListError(
        "network",
        `List servers failed (${result.status})`,
      );
    }
    const parsed = accountServersResponseSchema.safeParse(result.body);
    if (!parsed.success) {
      throw new ConnectListError(
        "invalid_response",
        "List servers response failed schema validation",
      );
    }
    return {
      servers: parsed.data.servers.map((server) => ({
        ...server,
        url: serverUrlForHandle(identity.baseUrl, server.handle),
      })),
      selfHandle: identity.handle,
    };
  }

  async createDesktopSession(): Promise<DesktopSession> {
    const result = await this.sendListing({
      target: "gate",
      method: "POST",
      path: "/api/connect/desktop-session",
      body: null,
    });
    if (result.status === 401 || result.status === 403) {
      throw new ConnectListError(
        "unauthorized",
        "Desktop session not authorized",
      );
    }
    if (result.status < 200 || result.status >= 300) {
      throw new ConnectListError(
        "network",
        `Desktop session failed (${result.status})`,
      );
    }
    const parsed = desktopSessionResponseSchema.safeParse(result.body);
    if (!parsed.success) {
      throw new ConnectListError(
        "invalid_response",
        "Desktop session response failed schema validation",
      );
    }
    return parsed.data;
  }

  async createMachineCode(signal?: AbortSignal): Promise<MachineCode> {
    let result: AccountFetchResult;
    try {
      result = await this.send(
        {
          target: "api",
          method: "POST",
          path: "/api/connect/machine-code",
          body: null,
        },
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (
        error instanceof NotSignedInError ||
        error instanceof AccountUnavailableError
      ) {
        throw new MachineCodeError("not_paired");
      }
      throw new MachineCodeError("network");
    }
    if (result.status === 409) throw new MachineCodeError("machine_limit");
    if (result.status === 401) throw new MachineCodeError("not_paired");
    if (result.status < 200 || result.status >= 300) {
      throw new MachineCodeError("network");
    }
    const parsed = machineCodeResponseSchema.safeParse(result.body);
    if (!parsed.success) throw new MachineCodeError("network");
    return {
      code: parsed.data.code,
      expiresAt: Date.now() + parsed.data.expiresInMs,
      serverUrl: parsed.data.serverUrl,
    };
  }

  async lookupMachineCode(
    code: string,
    signal?: AbortSignal,
  ): Promise<{ consumed: boolean; machineId: string | null }> {
    const result = await this.send(
      {
        target: "api",
        method: "POST",
        path: "/api/connect/machine-code-lookup",
        body: { code },
      },
      signal,
    );
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Machine code lookup failed (${result.status})`);
    }
    return machineCodeLookupSchema.parse(result.body);
  }

  async revokeMachine(machineId: string, signal?: AbortSignal): Promise<void> {
    const result = await this.send(
      {
        target: "api",
        method: "POST",
        path: "/api/connect/revoke-machine",
        body: { machineId },
      },
      signal,
    );
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`machine revoke failed (${result.status})`);
    }
    revokeMachineResponseSchema.parse(result.body);
  }

  private async sendListing(
    request: AccountFetchRequest,
  ): Promise<AccountFetchResult> {
    try {
      return await this.send(request);
    } catch (error) {
      if (
        error instanceof NotSignedInError ||
        error instanceof AccountUnavailableError
      ) {
        throw new ConnectListError(
          "not_paired",
          "this bb isn't signed in to a bb account — run `bb account login`",
        );
      }
      throw new ConnectListError(
        "network",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async send(
    request: AccountFetchRequest,
    signal?: AbortSignal,
  ): Promise<AccountFetchResult> {
    const result = await abortable(this.account.fetch(request), signal);
    if (
      result.status === 401 &&
      signedOutBodySchema.safeParse(result.body).success
    ) {
      throw new NotSignedInError();
    }
    return result;
  }
}
