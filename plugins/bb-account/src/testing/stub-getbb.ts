import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

export interface StubRequest {
  site: "apex" | "gate";
  method: string;
  path: string;
  authorization: string | null;
  machineHeader: string | null;
  body: unknown;
}

export interface StubReply {
  status: number;
  body?: unknown;
}

export type StubRoute = (
  request: StubRequest,
) => StubReply | Promise<StubReply>;

export interface StubServerRecord {
  serverId: string;
  serverLabel: string;
  userId: string;
  githubLogin: string | null;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
}

interface LinkRecord {
  userCode: string;
  deviceCode: string;
  state: "pending" | "approved" | "denied" | "consumed";
  server: StubServerRecord | null;
  expiresAt: number;
  lastPollAt: number | null;
  polls: number;
}

export interface TunnelDial {
  authorization: string | null;
  socket: WebSocket | null;
}

const DEFAULT_SERVER: StubServerRecord = {
  serverId: "srv_1",
  serverLabel: "sawyer-desktop",
  userId: "usr_1",
  githubLogin: "sawyerhood",
  name: "Sawyer Hood",
  avatarUrl: "https://avatars.example.test/sawyer.png",
  handle: "sawyer",
};

function token(prefix: string): string {
  return `${prefix}${randomBytes(18).toString("base64url")}`;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function send(response: ServerResponse, reply: StubReply): void {
  if (reply.body === undefined) {
    response.writeHead(reply.status);
    response.end();
    return;
  }
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

export class StubGetbb {
  readonly requests: StubRequest[] = [];
  readonly tunnelDials: TunnelDial[] = [];
  readonly mintedTickets: string[] = [];
  readonly revokedCredentials: string[] = [];
  apexUrl = "";
  gateUrl = "";
  linkIntervalMs = 20;
  enforceLinkInterval = false;
  rejectTunnelDialsWith: number | null = null;
  private readonly credentials = new Map<string, StubServerRecord>();
  private readonly links = new Map<string, LinkRecord>();
  private readonly redeemCodes = new Map<
    string,
    { server: StubServerRecord; used: boolean; expired: boolean }
  >();
  private readonly routes = new Map<string, StubRoute>();
  private readonly holds = new Map<
    string,
    { matches: (request: StubRequest) => boolean; released: Promise<void> }
  >();
  private readonly apex = createServer((request, response) => {
    void this.handle("apex", request, response);
  });
  private readonly gate = createServer((request, response) => {
    void this.handle("gate", request, response);
  });
  private readonly sockets = new Set<Socket>();
  private readonly tunnelServer = new WebSocketServer({ noServer: true });

  static async start(): Promise<StubGetbb> {
    const stub = new StubGetbb();
    for (const server of [stub.apex, stub.gate]) {
      server.on("connection", (socket) => {
        stub.sockets.add(socket);
        socket.on("close", () => stub.sockets.delete(socket));
      });
    }
    stub.gate.on("upgrade", (request, socket, head) => {
      stub.upgrade(request, socket as Socket, head);
    });
    stub.apexUrl = await listen(stub.apex);
    stub.gateUrl = await listen(stub.gate);
    return stub;
  }

  async close(): Promise<void> {
    for (const client of this.tunnelServer.clients) client.terminate();
    this.tunnelServer.close();
    for (const socket of this.sockets) socket.destroy();
    await Promise.all(
      [this.apex, this.gate].map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }

  get tunnelUrl(): string {
    return `${this.gateUrl.replace(/^http/u, "ws")}/__tunnel`;
  }

  issueCredential(server: Partial<StubServerRecord> = {}): string {
    const credential = token("bbcred_");
    this.credentials.set(credential, { ...DEFAULT_SERVER, ...server });
    return credential;
  }

  revoke(credential: string): void {
    this.credentials.delete(credential);
    this.revokedCredentials.push(credential);
  }

  isValid(credential: string): boolean {
    return this.credentials.has(credential);
  }

  issueRedeemCode(
    code: string,
    options: { server?: Partial<StubServerRecord>; expired?: boolean } = {},
  ): void {
    this.redeemCodes.set(code, {
      server: { ...DEFAULT_SERVER, ...options.server },
      used: false,
      expired: options.expired ?? false,
    });
  }

  approveLink(userCode: string, server: Partial<StubServerRecord> = {}): void {
    const link = this.linkByUserCode(userCode);
    link.state = "approved";
    link.server = { ...DEFAULT_SERVER, ...server };
  }

  denyLink(userCode: string): void {
    this.linkByUserCode(userCode).state = "denied";
  }

  expireLink(userCode: string): void {
    this.linkByUserCode(userCode).expiresAt = Date.now() - 1;
  }

  linkPolls(userCode: string): number {
    return this.linkByUserCode(userCode).polls;
  }

  route(method: string, path: string, handler: StubRoute): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  hold(
    method: string,
    path: string,
    matches: (request: StubRequest) => boolean = () => true,
  ): () => void {
    const key = `${method} ${path}`;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.set(key, { matches, released });
    return () => {
      if (this.holds.get(key)?.released === released) this.holds.delete(key);
      release();
    };
  }

  requestsTo(path: string): StubRequest[] {
    return this.requests.filter((request) => request.path === path);
  }

  private linkByUserCode(userCode: string): LinkRecord {
    for (const link of this.links.values()) {
      if (link.userCode === userCode) return link;
    }
    throw new Error(`unknown link ${userCode}`);
  }

  private authorized(request: StubRequest): StubServerRecord | null {
    const bearer = request.authorization?.startsWith("Bearer ")
      ? request.authorization.slice(7)
      : null;
    const credential = bearer ?? request.machineHeader;
    if (credential === null) return null;
    return this.credentials.get(credential) ?? null;
  }

  private profile(server: StubServerRecord) {
    return {
      userId: server.userId,
      githubLogin: server.githubLogin,
      name: server.name,
      avatarUrl: server.avatarUrl,
      handle: server.handle,
      serverId: server.serverId,
      serverLabel: server.serverLabel,
      serverUrl: this.gateUrl,
      tunnelUrl: this.tunnelUrl,
    };
  }

  private async handle(
    site: "apex" | "gate",
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://stub.invalid");
    const record: StubRequest = {
      site,
      method: request.method ?? "GET",
      path: url.pathname,
      authorization: request.headers.authorization ?? null,
      machineHeader:
        typeof request.headers["x-bb-connect-machine"] === "string"
          ? request.headers["x-bb-connect-machine"]
          : null,
      body: await readBody(request),
    };
    this.requests.push(record);
    const hold = this.holds.get(`${record.method} ${record.path}`);
    if (hold !== undefined && hold.matches(record)) await hold.released;
    const custom = this.routes.get(`${record.method} ${record.path}`);
    if (custom !== undefined) {
      send(response, await custom(record));
      return;
    }
    send(response, this.builtin(record));
  }

  private builtin(request: StubRequest): StubReply {
    const key = `${request.site} ${request.method} ${request.path}`;
    switch (key) {
      case "apex GET /api/account/me": {
        const server = this.authorized(request);
        if (server === null) {
          return { status: 401, body: { error: "unauthorized" } };
        }
        return { status: 200, body: this.profile(server) };
      }
      case "apex POST /api/account/link/start": {
        const deviceCode = token("dev_");
        const userCode = `${randomBytes(2).toString("hex").toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
        const expiresAt = Date.now() + 10 * 60 * 1000;
        this.links.set(deviceCode, {
          userCode,
          deviceCode,
          state: "pending",
          server: null,
          expiresAt,
          lastPollAt: null,
          polls: 0,
        });
        return {
          status: 200,
          body: {
            deviceCode,
            userCode,
            verificationUrl: `${this.apexUrl}/link?code=${userCode}`,
            expiresAt,
            intervalMs: this.linkIntervalMs,
          },
        };
      }
      case "apex POST /api/account/link/poll": {
        const body = request.body as { deviceCode?: string } | null;
        const link = this.links.get(body?.deviceCode ?? "");
        if (link === undefined) {
          return { status: 404, body: { error: "invalid-code" } };
        }
        link.polls += 1;
        const now = Date.now();
        if (
          this.enforceLinkInterval &&
          link.lastPollAt !== null &&
          now - link.lastPollAt < this.linkIntervalMs
        ) {
          link.lastPollAt = now;
          return { status: 429, body: { error: "slow-down" } };
        }
        link.lastPollAt = now;
        if (link.state === "consumed") {
          return { status: 409, body: { error: "already-used" } };
        }
        if (link.state === "denied") {
          return { status: 403, body: { error: "denied" } };
        }
        if (now > link.expiresAt) {
          return { status: 410, body: { error: "expired" } };
        }
        if (link.state === "pending" || link.server === null) {
          return { status: 200, body: { status: "pending" } };
        }
        link.state = "consumed";
        const credential = token("bbcred_");
        this.credentials.set(credential, link.server);
        return {
          status: 200,
          body: {
            status: "approved",
            credential,
            serverId: link.server.serverId,
            handle: link.server.serverLabel,
            serverUrl: this.gateUrl,
            tunnelUrl: this.tunnelUrl,
          },
        };
      }
      case "apex POST /api/connect/redeem": {
        const body = request.body as { code?: string } | null;
        const entry = this.redeemCodes.get(body?.code ?? "");
        if (entry === undefined) {
          return { status: 404, body: { error: "invalid-code" } };
        }
        if (entry.used) return { status: 409, body: { error: "already-used" } };
        if (entry.expired) return { status: 410, body: { error: "expired" } };
        entry.used = true;
        const credential = token("bbcred_");
        this.credentials.set(credential, entry.server);
        return {
          status: 200,
          body: {
            credential,
            serverId: entry.server.serverId,
            handle: entry.server.serverLabel,
            tunnelUrl: this.tunnelUrl,
          },
        };
      }
      case "apex POST /api/connect/tunnel-ticket": {
        const server = this.authorized(request);
        if (server === null) {
          return { status: 401, body: { error: "unauthorized" } };
        }
        const ticket = token("bbtkt_");
        this.mintedTickets.push(ticket);
        return {
          status: 200,
          body: {
            ticket,
            tunnelUrl: this.tunnelUrl,
            expiresAt: Date.now() + 5 * 60 * 1000,
          },
        };
      }
      case "gate POST /api/connect/disconnect": {
        const server = this.authorized(request);
        if (server === null) {
          return { status: 401, body: { error: "unauthorized" } };
        }
        const credential =
          request.machineHeader ?? request.authorization?.slice(7) ?? "";
        this.revoke(credential);
        return { status: 200, body: { ok: true } };
      }
    }
    return { status: 404, body: { error: "not-found" } };
  }

  private upgrade(
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void {
    const url = new URL(request.url ?? "/", "http://stub.invalid");
    const authorization = request.headers.authorization ?? null;
    if (url.pathname !== "/__tunnel") {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const ticket = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const rejection =
      this.rejectTunnelDialsWith ??
      (this.mintedTickets.includes(ticket) ? null : 401);
    if (rejection !== null) {
      this.tunnelDials.push({ authorization, socket: null });
      socket.end(
        `HTTP/1.1 ${rejection} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      );
      return;
    }
    this.tunnelServer.handleUpgrade(request, socket, head, (ws) => {
      this.tunnelDials.push({ authorization, socket: ws });
    });
  }
}
