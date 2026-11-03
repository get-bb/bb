import {
  getRequestListener,
  type Http2Bindings,
  type HttpBindings,
} from "@hono/node-server";
import {
  createServer,
  IncomingMessage,
  STATUS_CODES,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { Duplex } from "node:stream";
import {
  GATE_ASSERTION_HEADER,
  GATE_PUBLIC_PATHS,
  type GateAssertionClaims,
} from "@bb/tunnel-contract/next";
import { markTunnelIngressRequest } from "../../request-context.js";
import type { ServerLogger } from "../../types.js";
import type { GateKeyStore, GateKeyVerification } from "./gate-keys.js";

const TUNNEL_INGRESS_HOST = "127.0.0.1";
const GATE_HEADER_PREFIX = "x-bb-gate-";
const GATE_AUTH_HEADER = "x-bb-gate-auth";
const GATE_MACHINE_ID_HEADER = "x-bb-gate-machine-id";
const GATE_OAUTH_SCOPE_HEADER = "x-bb-gate-oauth-scope";
const GATE_OAUTH_GRANT_HEADER = "x-bb-gate-oauth-grant";
const GATE_OAUTH_CLIENT_HEADER = "x-bb-gate-oauth-client";
const PUBLIC_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export type TunnelIngressRefusal =
  | Extract<GateKeyVerification, { ok: false }>["reason"]
  | "missing"
  | "bad_request_target"
  | "unexpected_target"
  | "not_public";

type IngressVerification =
  | { ok: true; claims: GateAssertionClaims; pathAndQuery: string }
  | { ok: false; reason: TunnelIngressRefusal };

export interface TunnelIngressLease {
  baseUrl: string;
  close(): Promise<void>;
}

export interface TunnelIngressManager {
  open(audience: string): Promise<TunnelIngressLease>;
  closeAll(): Promise<void>;
}

interface TunnelIngressApp {
  fetch(
    request: Request,
    env: HttpBindings | Http2Bindings,
  ): Response | Promise<Response>;
}

export interface CreateTunnelIngressManagerArgs {
  app: TunnelIngressApp;
  injectWebSocket: (server: Server) => void;
  keys: GateKeyStore;
  loopbackOrigin: () => string;
  logger: Pick<ServerLogger, "debug" | "warn">;
}

interface Ingress {
  audience: string;
  baseUrl: string;
  server: Server;
  stopped: Promise<void> | null;
  upgradedSockets: Set<Duplex>;
}

interface IngressEntry {
  refs: number;
  ready: Promise<Ingress>;
}

interface IngressHeaderArgs {
  claims: GateAssertionClaims;
  loopbackOrigin: string;
}

export function tunnelIngressHeaders(
  entries: Iterable<readonly [string, string]>,
  args: IngressHeaderArgs,
): Record<string, string> {
  const loopbackHost = new URL(args.loopbackOrigin).host;
  const headers: Record<string, string> = {};
  let publicHost: string | null = null;
  for (const [rawName, value] of entries) {
    const name = rawName.toLowerCase();
    if (name.startsWith(GATE_HEADER_PREFIX)) continue;
    if (name === "host") {
      publicHost = value;
      continue;
    }
    headers[name] = value;
  }
  const origin = headers.origin;
  if (
    origin !== undefined &&
    publicHost !== null &&
    (origin === `https://${publicHost}` || origin === `http://${publicHost}`)
  ) {
    headers.origin = args.loopbackOrigin;
  }
  headers.host = loopbackHost;
  const { claims } = args;
  if (claims.kind === "public") {
    delete headers.authorization;
    delete headers.cookie;
    return headers;
  }
  headers[GATE_AUTH_HEADER] = claims.kind;
  if (claims.kind === "machine") {
    headers[GATE_MACHINE_ID_HEADER] = claims.sub;
  }
  if (claims.kind === "oauth" && claims.oauth !== null) {
    delete headers.authorization;
    delete headers.cookie;
    headers[GATE_OAUTH_SCOPE_HEADER] = claims.oauth.scope;
    headers[GATE_OAUTH_GRANT_HEADER] = claims.oauth.grantId;
    headers[GATE_OAUTH_CLIENT_HEADER] = claims.oauth.clientName;
  }
  return headers;
}

function isPublicRequest(method: string, pathAndQuery: string): boolean {
  const pathname = pathAndQuery.split("?", 1)[0] ?? "";
  return (
    PUBLIC_METHODS.has(method.toUpperCase()) && GATE_PUBLIC_PATHS.has(pathname)
  );
}

function incomingHeaderEntries(
  headers: IncomingHttpHeaders,
): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    entries.push([name, Array.isArray(value) ? value.join(", ") : value]);
  }
  return entries;
}

function refusalBody(reason: TunnelIngressRefusal): string {
  return JSON.stringify({
    code: "gate_assertion_invalid",
    message: "This request did not come through the bb connect gate",
    reason,
  });
}

function refusalResponse(reason: TunnelIngressRefusal): Response {
  return new Response(refusalBody(reason), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function refuseUpgrade(socket: Duplex, reason: TunnelIngressRefusal): void {
  const body = refusalBody(reason);
  socket.end(
    `HTTP/1.1 401 ${STATUS_CODES[401]}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body,
  );
}

export function createTunnelIngressManager(
  args: CreateTunnelIngressManagerArgs,
): TunnelIngressManager {
  const entries = new Map<string, IngressEntry>();
  let relay: Server | null = null;

  function upgradeRelay(): Server {
    if (relay === null) {
      relay = createServer();
      args.injectWebSocket(relay);
    }
    return relay;
  }

  async function verify(
    audience: string,
    incoming: IncomingMessage,
  ): Promise<IngressVerification> {
    const pathAndQuery = incoming.url;
    const method = incoming.method;
    if (
      pathAndQuery === undefined ||
      !pathAndQuery.startsWith("/") ||
      method === undefined
    ) {
      return { ok: false, reason: "bad_request_target" };
    }
    const token = incoming.headers[GATE_ASSERTION_HEADER];
    if (typeof token !== "string" || token.length === 0) {
      return { ok: false, reason: "missing" };
    }
    const result = await args.keys.verify(token, {
      audience,
      method,
      pathAndQuery,
    });
    if (!result.ok) return result;
    if (result.claims.target !== null) {
      return { ok: false, reason: "unexpected_target" };
    }
    if (result.claims.kind === "oauth" && result.claims.oauth === null) {
      return { ok: false, reason: "malformed" };
    }
    if (
      result.claims.kind === "public" &&
      !isPublicRequest(method, pathAndQuery)
    ) {
      return { ok: false, reason: "not_public" };
    }
    return { ok: true, claims: result.claims, pathAndQuery };
  }

  function logRefusal(
    audience: string,
    incoming: IncomingMessage,
    reason: TunnelIngressRefusal,
  ): void {
    args.logger.debug(
      {
        audience,
        method: incoming.method,
        path: incoming.url?.split("?", 1)[0],
        reason,
      },
      "Refused a bb connect tunnel ingress request",
    );
  }

  async function handleHttp(
    audience: string,
    request: Request,
    env: HttpBindings | Http2Bindings,
  ): Promise<Response> {
    const incoming = env.incoming;
    if (!(incoming instanceof IncomingMessage)) {
      return refusalResponse("bad_request_target");
    }
    const verification = await verify(audience, incoming);
    if (!verification.ok) {
      logRefusal(audience, incoming, verification.reason);
      return refusalResponse(verification.reason);
    }
    const loopbackOrigin = args.loopbackOrigin();
    const headers = tunnelIngressHeaders(request.headers.entries(), {
      claims: verification.claims,
      loopbackOrigin,
    });
    markTunnelIngressRequest(incoming);
    const init: RequestInit & { duplex: "half" } = {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      signal: request.signal,
    };
    return args.app.fetch(
      new Request(`${loopbackOrigin}${verification.pathAndQuery}`, init),
      env,
    );
  }

  async function handleUpgrade(
    ingress: Ingress,
    incoming: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    ingress.upgradedSockets.add(socket);
    socket.once("close", () => ingress.upgradedSockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const verification = await verify(ingress.audience, incoming);
    if (!verification.ok) {
      logRefusal(ingress.audience, incoming, verification.reason);
      refuseUpgrade(socket, verification.reason);
      return;
    }
    incoming.headers = tunnelIngressHeaders(
      incomingHeaderEntries(incoming.headers),
      { claims: verification.claims, loopbackOrigin: args.loopbackOrigin() },
    );
    markTunnelIngressRequest(incoming);
    upgradeRelay().emit("upgrade", incoming, socket, head);
  }

  async function listen(audience: string): Promise<Ingress> {
    const upgradedSockets = new Set<Duplex>();
    const server = createServer(
      getRequestListener((request, env) => handleHttp(audience, request, env)),
    );
    const ingress: Ingress = {
      audience,
      baseUrl: "",
      server,
      stopped: null,
      upgradedSockets,
    };
    server.on("upgrade", (incoming: IncomingMessage, socket: Duplex, head) => {
      void handleUpgrade(ingress, incoming, socket, head).catch(
        (error: unknown) => {
          args.logger.warn(
            { err: error, audience },
            "bb connect tunnel ingress upgrade failed",
          );
          socket.destroy();
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, TUNNEL_INGRESS_HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("tunnel ingress did not bind a TCP port");
    }
    ingress.baseUrl = `http://${TUNNEL_INGRESS_HOST}:${address.port}`;
    return ingress;
  }

  function stop(ingress: Ingress): Promise<void> {
    ingress.stopped ??= new Promise<void>((resolve) => {
      ingress.server.close(() => resolve());
      ingress.server.closeAllConnections();
      for (const socket of ingress.upgradedSockets) socket.destroy();
      ingress.upgradedSockets.clear();
    });
    return ingress.stopped;
  }

  async function settleAndStop(entry: IngressEntry): Promise<void> {
    const ingress = await entry.ready.catch(() => null);
    if (ingress !== null) await stop(ingress);
  }

  return {
    async open(audience) {
      if (typeof audience !== "string" || audience.length === 0) {
        throw new Error("tunnel ingress audience must be a non-empty string");
      }
      let entry = entries.get(audience);
      if (entry === undefined) {
        entry = { refs: 0, ready: listen(audience) };
        entries.set(audience, entry);
      }
      const opened = entry;
      opened.refs += 1;
      let ingress: Ingress;
      try {
        ingress = await opened.ready;
      } catch (error) {
        opened.refs -= 1;
        if (entries.get(audience) === opened) entries.delete(audience);
        throw error;
      }
      let released = false;
      return {
        baseUrl: ingress.baseUrl,
        close: async () => {
          if (released) return;
          released = true;
          opened.refs -= 1;
          if (opened.refs > 0) return;
          if (entries.get(audience) === opened) entries.delete(audience);
          await stop(ingress);
        },
      };
    },
    async closeAll() {
      const all = [...entries.values()];
      entries.clear();
      await Promise.all(all.map(settleAndStop));
    },
  };
}
