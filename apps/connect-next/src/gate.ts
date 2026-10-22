import * as http from "node:http";
import * as net from "node:net";
import type { Duplex, Readable } from "node:stream";
import { parseVisitorHost } from "@bb/connect-db";
import {
  FRP_WEBSOCKET_PATH,
  signGateAssertion,
  type GateSigningKey,
} from "@bb/tunnel-contract/next";
import type { AccountApi } from "./account-api.js";
import {
  AssetCache,
  cacheableMaxAge,
  isRevalidatableShell,
  type StoredResponse,
} from "./asset-cache.js";
import {
  compressor,
  preferredEncoding,
  shouldCompress,
  type Encoding,
} from "./compress.js";
import type { TunnelDirectory } from "./directory.js";
import { upstreamHeaders, visitorHeaders } from "./forwarding.js";
import type { FrpConnections } from "./frp-connections.js";
import {
  appendVary,
  getHeader,
  pairsFromRaw,
  pairsFromReply,
  setHeader,
  single,
  withoutHeaders,
  type HeaderPairs,
} from "./headers.js";
import { errorText, type Log } from "./log.js";
import { gateErrorReply, offlinePage, offlineText } from "./pages.js";
import {
  PEER_FORWARD_HEADER,
  PEER_MISS_HEADER,
  REPLAY_HEADER,
  type PeerRouting,
} from "./regions.js";
import { text, type Reply } from "./reply.js";
import {
  MAX_MACHINE_LABEL_BODY_BYTES,
  type MachineLabelProxy,
} from "./machine-label.js";
import { trackServerFrames } from "./ws-frames.js";
import type { SessionRefresher } from "./session-refresh.js";
import {
  decideVisit,
  tunnelHost,
  wantsHtml,
  hostPortSuffix,
  withoutPort,
  type Forward,
  type VisitorPolicy,
} from "./visitor.js";

export const HEALTH_PATH = "/__gate/health";
export const RESP_HEAD_TIMEOUT_MS = 30_000;
export const VOICE_TRANSCRIPTION_RESP_HEAD_TIMEOUT_MS = 90_000;
const MAX_VISITOR_RESOLVE_MS = 8_000;
const FRP_GOODBYE_MS = 1_000;
const MAX_REFUSAL_BYTES = 4096;
const VOICE_TRANSCRIPTION_PATH = "/api/v1/system/voice-transcription";
export const MAX_REPLAY_BODY_BYTES = 1024 * 1024;

export interface GateDeadlines {
  headMs: number;
  transcriptionHeadMs: number;
}

export interface GateOptions {
  policy: VisitorPolicy;
  accounts: AccountApi;
  directory: TunnelDirectory;
  signingKey: GateSigningKey;
  cache: AssetCache;
  refreshSession: SessionRefresher;
  routing: PeerRouting | null;
  frpConnections: FrpConnections;
  vhost: { host: string; port: number };
  frpBind: { host: string; port: number };
  log: Log;
  machineLabels?: MachineLabelProxy;
  deadlines?: GateDeadlines;
  now?: () => number;
}

type Stage = "routing" | "tunnel" | "response-head";

const STALL_MESSAGES: Record<Stage, string> = {
  routing: "checking access",
  tunnel: "waiting for this server's tunnel",
  "response-head": "waiting for the tunnel client",
};

interface Prepared {
  status: number;
  headers: HeaderPairs;
  body: Readable | Buffer;
  compress: Encoding;
  store: ((entry: StoredResponse) => void) | null;
  cacheState: string | null;
  cookies: string[];
}

interface Exchange {
  method: string;
  host: string;
  url: string;
  pathname: string;
  stage: Stage;
  signal: AbortSignal;
  auth: string | null;
}

interface Upstream {
  host: string;
  port: number;
  auth: string | null;
}

type Route =
  | { kind: "upstream"; subdomain: string; upstream: Upstream }
  | { kind: "replay"; header: string }
  | { kind: "offline" };

const OFFLINE: Route = { kind: "offline" };

class Stalled extends Error {}

export function isReplayable(request: http.IncomingMessage): boolean {
  if (request.headers["transfer-encoding"] !== undefined) return false;
  const length = Number(request.headers["content-length"] ?? "0");
  return Number.isFinite(length) && length <= MAX_REPLAY_BODY_BYTES;
}

export const REPLAY_ELSEWHERE = "elsewhere=true";

function drainingReply(): Reply {
  return {
    status: 409,
    headers: {
      [REPLAY_HEADER]: REPLAY_ELSEWHERE,
      "content-type": "text/plain; charset=utf-8",
    },
    body: "bb connect: this gate machine is stopping\n",
  };
}

function replayReply(header: string): Reply {
  return {
    status: 409,
    headers: {
      [REPLAY_HEADER]: header,
      "content-type": "text/plain; charset=utf-8",
    },
    body: "bb connect: this server's tunnel is held in another region\n",
  };
}

function pathnameOf(url: string): string {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
}

function headDeadlineMs(
  deadlines: GateDeadlines,
  method: string,
  pathname: string,
  target: string | null,
): number {
  return method === "POST" &&
    pathname === VOICE_TRANSCRIPTION_PATH &&
    target === null
    ? deadlines.transcriptionHeadMs
    : deadlines.headMs;
}

function preparedReply(reply: Reply): Prepared {
  return {
    status: reply.status,
    headers: pairsFromReply(reply.headers),
    body: Buffer.from(reply.body),
    compress: "identity",
    store: null,
    cacheState: null,
    cookies: [],
  };
}

function rawResponse(status: number, headers: HeaderPairs, body: Buffer) {
  const lines = [`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ""}`];
  for (const [name, value] of headers) lines.push(`${name}: ${value}`);
  return Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), body]);
}

function rawRequestHead(request: http.IncomingMessage, origin: string): string {
  const lines = [`${request.method} ${request.url} HTTP/1.1`];
  const raw = request.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index]?.toLowerCase() === "origin") continue;
    lines.push(`${raw[index]}: ${raw[index + 1]}`);
  }
  lines.push(`Origin: ${origin}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

export function createGate(options: GateOptions) {
  const { policy, directory, cache, routing, log } = options;
  const now = options.now ?? Date.now;
  const deadlines = options.deadlines ?? {
    headMs: RESP_HEAD_TIMEOUT_MS,
    transcriptionHeadMs: VOICE_TRANSCRIPTION_RESP_HEAD_TIMEOUT_MS,
  };
  const visitorResolveMs = Math.min(
    MAX_VISITOR_RESOLVE_MS,
    deadlines.headMs / 3,
  );
  const accounts: AccountApi = {
    resolve: (request, resolveOptions) =>
      options.accounts.resolve(request, {
        deadlineMs: visitorResolveMs,
        ...resolveOptions,
      }),
    forget: (request) => options.accounts.forget(request),
    presence: (reports) => options.accounts.presence(reports),
  };
  const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });
  const upgraded = new Set<Duplex>();
  let draining = false;

  function subdomainFor(forward: Forward): string {
    return forward.target === null
      ? forward.label
      : `${forward.label}--${forward.target}`;
  }

  async function route(
    request: http.IncomingMessage,
    forward: Forward,
    exchange: Exchange,
    websocket: boolean,
  ): Promise<Route> {
    const subdomain = subdomainFor(forward);
    const local: Route = {
      kind: "upstream",
      subdomain,
      upstream: { ...options.vhost, auth: null },
    };
    if (directory.locate(subdomain).kind === "here") return local;
    const replayed =
      routing !== null && routing.isReplay(request.headers, forward.label);
    if (replayed) routing.missed(forward.label);
    exchange.stage = "tunnel";
    let located = await directory.lookup(subdomain, {
      signal: exchange.signal,
      fresh: replayed,
    });
    if (located.kind === "offline") {
      located = await directory.awaitReturn(subdomain, exchange.signal);
    }
    if (exchange.signal.aborted) throw new Stalled();
    if (located.kind === "here") return local;
    if (located.kind === "offline" || routing === null) return OFFLINE;
    if (!replayed && (websocket || isReplayable(request))) {
      log("info", "replay", {
        host: exchange.host,
        instance: located.instance,
      });
      return {
        kind: "replay",
        header: routing.replayHeader(forward.label, located.instance),
      };
    }
    const peer = routing.peer(located.instance);
    if (peer === null) return OFFLINE;
    log("info", "peer_forward", {
      host: exchange.host,
      instance: located.instance,
      replayed,
    });
    return { kind: "upstream", subdomain, upstream: peer };
  }

  function isPeerMiss(answer: http.IncomingMessage): boolean {
    return answer.headers[PEER_MISS_HEADER] !== undefined;
  }

  async function refusedAssertion(
    answer: http.IncomingMessage,
    forward: Forward,
    exchange: Exchange,
  ): Promise<Prepared | null> {
    if (answer.statusCode !== 401) return null;
    const type = answer.headers["content-type"] ?? "";
    const length = Number(answer.headers["content-length"] ?? Number.NaN);
    if (!type.includes("application/json") || !(length <= MAX_REFUSAL_BYTES)) {
      return null;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of answer) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body.toString());
    } catch {
      parsed = null;
    }
    const record =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    if (record.code !== "gate_assertion_invalid") {
      return {
        status: 401,
        headers: visitorHeaders(answer.rawHeaders, forward.installPath),
        body,
        compress: "identity",
        store: null,
        cacheState: null,
        cookies: [],
      };
    }
    const reason =
      typeof record.reason === "string" ? record.reason : "unknown";
    log("error", "assertion_refused", {
      label: forward.label,
      auth: forward.auth,
      method: exchange.method,
      path: exchange.pathname,
      reason,
    });
    return preparedReply(gateErrorReply(false));
  }

  function offlineReply(
    forward: Forward,
    request: http.IncomingMessage,
  ): Reply {
    if (!wantsHtml(request.headers)) return offlineText();
    const seen =
      forward.lastSeenAt === null ? null : new Date(forward.lastSeenAt);
    return offlinePage(seen, forward.labelKind);
  }

  async function assertionFor(forward: Forward, method: string) {
    return signGateAssertion(options.signingKey, {
      audience: forward.audience,
      subject: forward.subject,
      kind: forward.auth,
      method,
      pathAndQuery: forward.upstreamPath,
      target: forward.target,
      oauth: forward.oauth,
      nowSeconds: Math.floor(now() / 1000),
    });
  }

  async function upstreamFetch(
    request: http.IncomingMessage,
    forward: Forward,
    target: { subdomain: string; upstream: Upstream },
    exchange: Exchange,
    encoding: Encoding,
    ifNoneMatch: string | null,
    body: Readable | null,
  ): Promise<http.IncomingMessage> {
    const method = request.method ?? "GET";
    const { subdomain, upstream } = target;
    const headers = upstreamHeaders({
      headers: request.headers,
      forward,
      upstreamHost: `${subdomain}.${policy.baseDomain}${hostPortSuffix(exchange.host)}`,
      visitorHost: exchange.host,
      scheme: policy.scheme,
      assertion: await assertionFor(forward, method),
      acceptEncoding: encoding,
      websocket: false,
    });
    if (ifNoneMatch !== null) headers["if-none-match"] = ifNoneMatch;
    if (upstream.auth !== null) headers[PEER_FORWARD_HEADER] = upstream.auth;
    exchange.stage = "response-head";
    return new Promise((resolve, reject) => {
      const outgoing = http.request({
        host: upstream.host,
        port: upstream.port,
        method,
        path: forward.upstreamPath,
        headers,
        agent,
        signal: exchange.signal,
      });
      outgoing.on("response", resolve);
      outgoing.on("error", reject);
      if (body === null) outgoing.end();
      else body.pipe(outgoing);
    });
  }

  function fromUpstream(
    answer: http.IncomingMessage,
    forward: Forward,
    method: string,
    encoding: Encoding,
  ): Prepared {
    const status = answer.statusCode ?? 502;
    const headers = visitorHeaders(answer.rawHeaders, forward.installPath);
    return {
      status,
      headers,
      body: answer,
      compress: shouldCompress(method, status, headers) ? encoding : "identity",
      store: null,
      cacheState: null,
      cookies: [],
    };
  }

  function fromStored(
    entry: StoredResponse,
    cacheState: string,
    visitorEtag: string | null,
  ): Prepared {
    const etag = getHeader(entry.headers, "etag");
    if (visitorEtag !== null && etag !== null && visitorEtag === etag) {
      const headers = withoutHeaders(
        entry.headers,
        "content-length",
        "content-encoding",
        "content-type",
      );
      return {
        status: 304,
        headers,
        body: Buffer.alloc(0),
        compress: "identity",
        store: null,
        cacheState,
        cookies: [],
      };
    }
    return {
      status: entry.status,
      headers: entry.headers,
      body: entry.body,
      compress: "identity",
      store: null,
      cacheState,
      cookies: [],
    };
  }

  async function prepareForward(
    request: http.IncomingMessage,
    forward: Forward,
    exchange: Exchange,
  ): Promise<Prepared> {
    let refreshed: Promise<string[]> = Promise.resolve([]);
    const startRefresh = () => {
      if (forward.refreshSession !== null) {
        refreshed = options.refreshSession(forward.refreshSession);
      }
    };
    const prepared = await prepareUpstream(
      request,
      forward,
      exchange,
      startRefresh,
    );
    if (getHeader(prepared.headers, REPLAY_HEADER) !== null) return prepared;
    const platformCookies = [...(await refreshed)];
    if (forward.desktopSetCookie !== null) {
      platformCookies.push(forward.desktopSetCookie);
    }
    if (platformCookies.length === 0) return prepared;
    return { ...prepared, cookies: [...prepared.cookies, ...platformCookies] };
  }

  async function prepareUpstream(
    request: http.IncomingMessage,
    forward: Forward,
    exchange: Exchange,
    startRefresh: () => void,
  ): Promise<Prepared> {
    const method = request.method ?? "GET";
    const encoding = preferredEncoding(
      single(request.headers, "accept-encoding"),
    );
    const namespace =
      forward.target === null
        ? forward.routingKey
        : `${forward.routingKey}--${forward.target}`;
    const key = cache.key(namespace, forward.upstreamPath, encoding);
    const visitorEtag = single(request.headers, "if-none-match") ?? null;
    if (forward.cacheable) {
      const hit = cache.asset(key);
      if (hit !== undefined) {
        startRefresh();
        return fromStored(hit, "hit", visitorEtag);
      }
    }
    const routed = await route(request, forward, exchange, false);
    if (routed.kind === "replay") {
      request.resume();
      return preparedReply(replayReply(routed.header));
    }
    startRefresh();
    if (routed.kind === "offline") {
      request.resume();
      return preparedReply(offlineReply(forward, request));
    }
    if (!forward.cacheable) {
      const answer = await upstreamFetch(
        request,
        forward,
        routed,
        exchange,
        encoding,
        null,
        request,
      );
      if (isPeerMiss(answer)) {
        answer.resume();
        return preparedReply(offlineReply(forward, request));
      }
      return (
        (await refusedAssertion(answer, forward, exchange)) ??
        fromUpstream(answer, forward, method, encoding)
      );
    }
    request.resume();
    const shell = cache.shell(key);
    const conditional =
      shell === undefined
        ? null
        : (visitorEtag ?? getHeader(shell.headers, "etag"));
    const answer = await upstreamFetch(
      request,
      forward,
      routed,
      exchange,
      encoding,
      conditional,
      null,
    );
    if (isPeerMiss(answer)) {
      answer.resume();
      return preparedReply(offlineReply(forward, request));
    }
    const refusal = await refusedAssertion(answer, forward, exchange);
    if (refusal !== null) return refusal;
    const prepared = fromUpstream(answer, forward, method, encoding);
    if (shell !== undefined && prepared.status === 304) {
      answer.resume();
      if (visitorEtag !== null)
        return { ...prepared, cacheState: "revalidated" };
      const cacheControl =
        getHeader(prepared.headers, "cache-control") ?? "no-cache";
      return {
        ...fromStored(shell, "revalidated", null),
        headers: setHeader(shell.headers, "cache-control", cacheControl),
      };
    }
    const upstreamPairs = pairsFromRaw(answer.rawHeaders);
    if (isRevalidatableShell(prepared.status, upstreamPairs)) {
      return {
        ...prepared,
        cacheState: "miss",
        store: (entry) => cache.storeShell(key, entry),
      };
    }
    if (
      shell !== undefined &&
      prepared.status >= 200 &&
      prepared.status < 300
    ) {
      cache.dropShell(key);
    }
    const maxAge =
      shell === undefined
        ? cacheableMaxAge(prepared.status, upstreamPairs)
        : null;
    if (maxAge !== null) {
      return {
        ...prepared,
        cacheState: "miss",
        store: (entry) => cache.storeAsset(key, entry, maxAge),
      };
    }
    return prepared;
  }

  function finalHeaders(prepared: Prepared): HeaderPairs {
    let headers = prepared.headers;
    if (prepared.compress !== "identity") {
      headers = withoutHeaders(headers, "content-length");
      headers = setHeader(headers, "content-encoding", prepared.compress);
    }
    if (prepared.compress !== "identity" || prepared.store !== null) {
      headers = appendVary(headers, "Accept-Encoding");
    }
    return headers;
  }

  function send(
    response: http.ServerResponse,
    prepared: Prepared,
    method: string,
  ): void {
    const headers = finalHeaders(prepared);
    const shown: HeaderPairs = [
      ...headers,
      ...prepared.cookies.map((cookie): [string, string] => [
        "set-cookie",
        cookie,
      ]),
      ...(prepared.cacheState === null
        ? []
        : [["x-bb-cache", prepared.cacheState] as [string, string]]),
    ];
    response.writeHead(prepared.status, shown.flat());
    const { body } = prepared;
    if (Buffer.isBuffer(body)) {
      response.end(method === "HEAD" ? undefined : body);
      return;
    }
    let source: Readable = body;
    if (prepared.compress !== "identity") {
      const declared = getHeader(prepared.headers, "content-length");
      const length = declared === null ? Number.NaN : Number(declared);
      const encoder = compressor(prepared.compress, {
        length: Number.isSafeInteger(length) && length >= 0 ? length : null,
        stored: prepared.store !== null,
      });
      body.on("error", (error) => encoder.destroy(error));
      source = body.pipe(encoder);
    }
    const store = prepared.store;
    if (store !== null) {
      const chunks: Buffer[] = [];
      let size = 0;
      let keep = true;
      source.on("data", (chunk: Buffer) => {
        if (!keep) return;
        size += chunk.length;
        if (size > cache.maxEntryBytes) {
          keep = false;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      source.on("end", () => {
        if (!keep) return;
        store({
          status: prepared.status,
          headers,
          body: Buffer.concat(chunks),
        });
      });
    }
    source.on("error", () => response.destroy());
    response.on("close", () => {
      if (!response.writableFinished) {
        body.destroy();
        source.destroy();
      }
    });
    source.pipe(response);
  }

  async function withDeadline<T>(
    exchange: Exchange,
    controller: AbortController,
    deadlineMs: number,
    run: () => Promise<T>,
    discard: (late: T) => void,
  ): Promise<T | typeof STALLED> {
    let timer: NodeJS.Timeout | undefined;
    const stalled = new Promise<typeof STALLED>((resolve) => {
      timer = setTimeout(() => resolve(STALLED), deadlineMs);
    });
    const work = run();
    try {
      const winner = await Promise.race([work, stalled]);
      if (winner !== STALLED) return winner;
    } finally {
      clearTimeout(timer);
    }
    controller.abort();
    work.then(discard, () => {});
    log("warn", "stall", {
      stage: exchange.stage,
      method: exchange.method,
      host: exchange.host,
      path: exchange.pathname,
      deadlineMs,
    });
    return STALLED;
  }

  function stallReply(exchange: Exchange): Reply {
    return text(
      `bb connect: timed out ${STALL_MESSAGES[exchange.stage]} (stage: ${exchange.stage})\n`,
      504,
    );
  }

  function exchangeFor(
    request: http.IncomingMessage,
    signal: AbortSignal,
  ): Exchange {
    const url = request.url ?? "/";
    return {
      method: request.method ?? "GET",
      host: (single(request.headers, "host") ?? "").toLowerCase(),
      url,
      pathname: pathnameOf(url),
      stage: "routing",
      signal,
      auth: null,
    };
  }

  function deadlineFor(exchange: Exchange): number {
    const target =
      parseVisitorHost(withoutPort(exchange.host), policy.baseDomain)?.target ??
      null;
    return headDeadlineMs(
      deadlines,
      exchange.method,
      exchange.pathname,
      target,
    );
  }

  async function assignMachineLabel(
    request: http.IncomingMessage,
    credential: string,
  ): Promise<Reply> {
    const proxy = options.machineLabels;
    if (proxy === undefined) {
      request.resume();
      return text("bb connect: not found\n", 404);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_MACHINE_LABEL_BODY_BYTES) {
        request.resume();
        return text("bb connect: request too large\n", 413);
      }
      chunks.push(chunk as Buffer);
    }
    try {
      const answer = await proxy.assign(credential, Buffer.concat(chunks));
      log("info", "machine_label", { status: answer.status });
      return answer;
    } catch (error) {
      log("warn", "machine_label_failed", {
        error: error instanceof Error ? error.name : "error",
      });
      return text(
        "bb connect: the account service could not be reached\n",
        502,
      );
    }
  }

  async function serve(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const startedAt = now();
    const controller = new AbortController();
    const exchange = exchangeFor(request, controller.signal);
    if (exchange.pathname === HEALTH_PATH) {
      request.resume();
      if (draining) {
        response
          .writeHead(503, { "content-type": "text/plain" })
          .end("stopping\n");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    if (draining) {
      request.resume();
      send(response, preparedReply(drainingReply()), exchange.method);
      return;
    }
    response.on("close", () => {
      if (!response.writableFinished) controller.abort();
    });
    const outcome = await withDeadline(
      exchange,
      controller,
      deadlineFor(exchange),
      async () => {
        const decision = await decideVisit(
          {
            method: exchange.method,
            host: exchange.host,
            url: exchange.url,
            headers: request.headers,
            websocket: false,
          },
          policy,
          accounts,
        );
        if (decision.kind === "reply") {
          request.resume();
          return preparedReply(decision.reply);
        }
        if (decision.kind === "machine-label") {
          return preparedReply(
            await assignMachineLabel(request, decision.credential),
          );
        }
        exchange.auth = decision.forward.auth;
        return prepareForward(request, decision.forward, exchange);
      },
      (late) => {
        if (!Buffer.isBuffer(late.body)) late.body.destroy();
      },
    ).catch((error: unknown): Prepared => {
      request.resume();
      if (!controller.signal.aborted) {
        log("error", "request_failed", {
          method: exchange.method,
          host: exchange.host,
          path: exchange.pathname,
          stage: exchange.stage,
          error: errorText(error),
        });
      }
      return preparedReply(gateErrorReply(wantsHtml(request.headers)));
    });
    const prepared =
      outcome === STALLED ? preparedReply(stallReply(exchange)) : outcome;
    if (outcome === STALLED) request.resume();
    if (response.destroyed) {
      if (!Buffer.isBuffer(prepared.body)) prepared.body.destroy();
      return;
    }
    send(response, prepared, exchange.method);
    log("info", "request", {
      method: exchange.method,
      host: exchange.host,
      path: exchange.pathname,
      status: prepared.status,
      auth: exchange.auth,
      cache: prepared.cacheState,
      ms: now() - startedAt,
    });
  }

  function writeRefusal(socket: Duplex, reply: Reply): void {
    const body = Buffer.from(reply.body);
    const headers: HeaderPairs = [
      ...pairsFromReply(reply.headers),
      ["content-length", String(body.length)],
      ["connection", "close"],
    ];
    socket.end(rawResponse(reply.status, headers, body));
  }

  function pipeToFrps(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const origin = options.frpConnections.websocketOrigin();
    const frps = net.connect(options.frpBind.port, options.frpBind.host);
    const frames = trackServerFrames();
    options.frpConnections.track(origin, [socket, frps], () => {
      frps.unpipe(socket);
      socket.unpipe(frps);
      frps.destroy();
      if (socket.destroyed) return;
      socket.end(frames.closing());
      setTimeout(() => socket.destroy(), FRP_GOODBYE_MS).unref();
    });
    frps.on("error", () => socket.destroy());
    socket.on("error", () => frps.destroy());
    frps.on("connect", () => {
      frps.write(rawRequestHead(request, origin));
      if (head.length > 0) frps.write(head);
      frps.on("data", (chunk: Buffer) => frames.observe(chunk));
      frps.pipe(socket);
      socket.pipe(frps);
    });
    frps.on("close", () => {
      if (!socket.writableEnded) socket.destroy();
    });
    socket.on("close", () => frps.destroy());
  }

  async function upgradeVisitor(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    exchange: Exchange,
  ): Promise<void> {
    const controller = new AbortController();
    const scoped = { ...exchange, signal: controller.signal };
    socket.on("close", () => controller.abort());
    type Opened =
      | { kind: "reply"; reply: Reply }
      | {
          kind: "upgraded";
          answer: http.IncomingMessage;
          tunnel: Duplex;
          rest: Buffer;
        }
      | { kind: "answered"; answer: http.IncomingMessage; forward: Forward };
    const outcome = await withDeadline<Opened>(
      scoped,
      controller,
      deadlineFor(scoped),
      async () => {
        const decision = await decideVisit(
          {
            method: scoped.method,
            host: scoped.host,
            url: scoped.url,
            headers: request.headers,
            websocket: true,
          },
          policy,
          accounts,
        );
        if (decision.kind === "reply") return decision;
        if (decision.kind === "machine-label") {
          return { kind: "reply", reply: text("bb connect: not found\n", 404) };
        }
        const { forward } = decision;
        scoped.auth = forward.auth;
        const routed = await route(request, forward, scoped, true);
        if (routed.kind === "replay") {
          return { kind: "reply", reply: replayReply(routed.header) };
        }
        if (routed.kind === "offline") {
          return { kind: "reply", reply: offlineReply(forward, request) };
        }
        const { subdomain, upstream } = routed;
        const headers = upstreamHeaders({
          headers: request.headers,
          forward,
          upstreamHost: `${subdomain}.${policy.baseDomain}${hostPortSuffix(scoped.host)}`,
          visitorHost: scoped.host,
          scheme: policy.scheme,
          assertion: await assertionFor(forward, scoped.method),
          acceptEncoding: null,
          websocket: true,
        });
        if (upstream.auth !== null) {
          headers[PEER_FORWARD_HEADER] = upstream.auth;
        }
        scoped.stage = "response-head";
        return new Promise<Opened>((resolve, reject) => {
          const outgoing = http.request({
            host: upstream.host,
            port: upstream.port,
            method: scoped.method,
            path: forward.upstreamPath,
            headers,
            signal: controller.signal,
          });
          outgoing.on("error", reject);
          outgoing.on("upgrade", (answer, tunnel, rest) =>
            resolve({ kind: "upgraded", answer, tunnel, rest }),
          );
          outgoing.on("response", (answer) =>
            resolve({ kind: "answered", answer, forward }),
          );
          outgoing.end();
        });
      },
      (late) => {
        if (late.kind === "upgraded") late.tunnel.destroy();
        if (late.kind === "answered") late.answer.destroy();
      },
    ).catch((error: unknown): Opened => {
      if (!controller.signal.aborted) {
        log("error", "websocket_failed", {
          host: scoped.host,
          path: scoped.pathname,
          stage: scoped.stage,
          error: errorText(error),
        });
      }
      return { kind: "reply", reply: gateErrorReply(false) };
    });
    if (outcome === STALLED) {
      writeRefusal(socket, stallReply(scoped));
      return;
    }
    if (outcome.kind === "reply") {
      writeRefusal(socket, outcome.reply);
      return;
    }
    if (outcome.kind === "answered") {
      const { answer } = outcome;
      if (isPeerMiss(answer)) {
        answer.resume();
        writeRefusal(socket, offlineReply(outcome.forward, request));
        return;
      }
      if (answer.statusCode === 401) {
        log("warn", "websocket_refused_upstream", {
          host: scoped.host,
          path: scoped.pathname,
          auth: scoped.auth,
        });
      }
      const headers = [
        ...visitorHeaders(answer.rawHeaders, null).filter(
          ([name]) => name.toLowerCase() !== "content-length",
        ),
        ["connection", "close"] as [string, string],
      ];
      socket.write(
        rawResponse(answer.statusCode ?? 502, headers, Buffer.alloc(0)),
      );
      answer.pipe(socket);
      return;
    }
    const { answer, tunnel, rest } = outcome;
    tunnel.on("error", () => socket.destroy());
    socket.on("error", () => tunnel.destroy());
    const headers: HeaderPairs = [
      ["Connection", "Upgrade"],
      ["Upgrade", "websocket"],
      ...visitorHeaders(answer.rawHeaders, null),
    ];
    socket.write(rawResponse(101, headers, Buffer.alloc(0)));
    if (rest.length > 0) socket.write(rest);
    if (head.length > 0) tunnel.write(head);
    tunnel.pipe(socket);
    socket.pipe(tunnel);
    tunnel.on("close", () => socket.destroy());
    socket.on("close", () => tunnel.destroy());
    log("info", "websocket", {
      host: scoped.host,
      path: scoped.pathname,
      auth: scoped.auth,
    });
  }

  async function upgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    socket.on("error", () => {});
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
    if (draining) {
      writeRefusal(socket, drainingReply());
      return;
    }
    const exchange = exchangeFor(request, new AbortController().signal);
    const isWebSocket =
      (single(request.headers, "upgrade") ?? "").toLowerCase() === "websocket";
    if (withoutPort(exchange.host) === tunnelHost(policy.baseDomain)) {
      if (
        exchange.method === "GET" &&
        exchange.pathname === FRP_WEBSOCKET_PATH &&
        isWebSocket
      ) {
        pipeToFrps(request, socket, head);
        return;
      }
      writeRefusal(socket, text("bb connect: not found\n", 404));
      return;
    }
    if (!isWebSocket) {
      writeRefusal(socket, text("bb connect: unsupported upgrade\n", 400));
      return;
    }
    await upgradeVisitor(request, socket, head, exchange);
  }

  const server = http.createServer((request, response) => {
    serve(request, response).catch((error: unknown) => {
      log("error", "request_crashed", { error: errorText(error) });
      response.destroy();
    });
  });
  server.on("upgrade", (request, socket, head) => {
    upgrade(request, socket, head).catch((error: unknown) => {
      log("error", "upgrade_crashed", { error: errorText(error) });
      socket.destroy();
    });
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    else socket.destroy();
  });
  return {
    server,
    drain() {
      draining = true;
    },
    dropConnections() {
      for (const socket of upgraded) socket.destroy();
      upgraded.clear();
      server.closeAllConnections();
    },
    close: () => agent.destroy(),
  };
}

const STALLED = Symbol("stalled");
