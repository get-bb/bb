import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import type { IncomingHttpHeaders } from "node:http";
import {
  labelOf,
  type LabelPresence,
  type TunnelDirectory,
  type TunnelLocation,
} from "./directory.js";
import { single } from "./headers.js";
import { errorText, type Log } from "./log.js";

export const PEER_PATH = "/__peer";
export const PEER_FORWARD_HEADER = "x-bb-gate-peer-auth";
export const PEER_MISS_HEADER = "x-bb-gate-peer-miss";
export const REPLAY_HEADER = "fly-replay";
export const REPLAY_SOURCE_HEADER = "fly-replay-src";
export const PEER_REFRESH_MS = 30_000;
export const PEER_LOOKUP_TIMEOUT_MS = 1_500;
export const PEER_ANNOUNCE_TIMEOUT_MS = 2_000;
export const PEER_HELLO_TIMEOUT_MS = 3_000;
export const PEER_NEGATIVE_MS = 2_000;
const REPLAY_STATE_TTL_SECONDS = 60;
const LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export interface PeerSelf {
  machineId: string;
  region: string;
}

export interface PeerAnnouncement {
  label: string;
  machineId: string;
  region: string;
  state: LabelPresence;
  at: number;
}

export interface PeerHello {
  machineId: string;
  region: string;
  startedAt: number;
}

export interface PeerGoodbye {
  machineId: string;
  at: number;
}

export interface PeerSnapshot {
  machineId: string;
  region: string;
  labels: { label: string; at: number }[];
}

export type PeerLabelAnswer =
  | { held: true; machineId: string; region: string; at: number }
  | { held: false; machineId: string };

export interface PeerTarget {
  host: string;
  port: number;
  auth: string;
}

export interface PeerRouting {
  machineId: string;
  replayHeader(label: string, instance: string): string;
  isReplay(headers: IncomingHttpHeaders, label: string): boolean;
  peer(instance: string): PeerTarget | null;
  missed(label: string): void;
}

export type ResolvePeers = () => Promise<string[]>;

export interface RegionsOptions {
  local: TunnelDirectory;
  self: PeerSelf;
  secret: string;
  resolvePeers: ResolvePeers;
  refreshMs?: number;
  lookupTimeoutMs?: number;
  announceTimeoutMs?: number;
  helloTimeoutMs?: number;
  negativeMs?: number;
  log: Log;
  now?: () => number;
}

export interface Regions {
  directory: TunnelDirectory;
  routing: PeerRouting;
  onSuperseded(listener: (label: string) => void): void;
  authorized(header: string | undefined): boolean;
  receive(announcement: PeerAnnouncement): void;
  receiveGoodbye(goodbye: PeerGoodbye): void;
  answerLabel(label: string): PeerLabelAnswer;
  answerHello(hello: PeerHello): PeerSnapshot;
  peerCount(): number;
  start(): Promise<void>;
  stop(timeoutMs: number): Promise<void>;
}

interface Holder {
  machineId: string;
  region: string;
  at: number;
}

interface Peer {
  url: string;
  machineId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= 256;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isPeerLabel(value: unknown): value is string {
  return (
    typeof value === "string" && LABEL.test(value) && !value.includes("--")
  );
}

export function parseAnnouncement(value: unknown): PeerAnnouncement | null {
  if (!isRecord(value)) return null;
  const { label, machineId, region, state, at } = value;
  if (
    !isPeerLabel(label) ||
    !isText(machineId) ||
    !isText(region) ||
    (state !== "connected" && state !== "disconnected") ||
    !isTime(at)
  ) {
    return null;
  }
  return { label, machineId, region, state, at };
}

export function parseHello(value: unknown): PeerHello | null {
  if (!isRecord(value)) return null;
  const { machineId, region, startedAt } = value;
  if (!isText(machineId) || !isText(region) || !isTime(startedAt)) return null;
  return { machineId, region, startedAt };
}

class PeerStatusError extends Error {
  constructor(readonly status: number) {
    super(`peer answered HTTP ${status}`);
  }
}

export function parseGoodbye(value: unknown): PeerGoodbye | null {
  if (!isRecord(value)) return null;
  const { machineId, at } = value;
  if (!isText(machineId) || !isTime(at)) return null;
  return { machineId, at };
}

function parseSnapshot(value: unknown): PeerSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.labels)) return null;
  const { machineId, region } = value;
  if (!isText(machineId) || !isText(region)) return null;
  const labels: PeerSnapshot["labels"] = [];
  for (const entry of value.labels) {
    if (!isRecord(entry) || !isPeerLabel(entry.label) || !isTime(entry.at)) {
      return null;
    }
    labels.push({ label: entry.label, at: entry.at });
  }
  return { machineId, region, labels };
}

function parseLabelAnswer(value: unknown): PeerLabelAnswer | null {
  if (!isRecord(value) || !isText(value.machineId)) return null;
  if (value.held === false) return { held: false, machineId: value.machineId };
  if (value.held !== true || !isText(value.region) || !isTime(value.at)) {
    return null;
  }
  return {
    held: true,
    machineId: value.machineId,
    region: value.region,
    at: value.at,
  };
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

export function bearerMatches(
  header: string | undefined,
  secret: string,
): boolean {
  if (header === undefined) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

function replaySignature(
  secret: string,
  label: string,
  instance: string,
  expires: number,
): string {
  return createHmac("sha256", secret)
    .update(`replay\n${label}\n${instance}\n${expires}`)
    .digest("base64url")
    .slice(0, 22);
}

export function replayState(
  secret: string,
  label: string,
  instance: string,
  nowMs: number,
): string {
  const expires = Math.floor(nowMs / 1000) + REPLAY_STATE_TTL_SECONDS;
  return `${expires}.${replaySignature(secret, label, instance, expires)}`;
}

export function replayStateFrom(header: string | undefined): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim().toLowerCase() !== "state") continue;
    return part
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/gu, "");
  }
  return null;
}

export function verifyReplayState(
  secret: string,
  state: string,
  label: string,
  instance: string,
  nowMs: number,
): boolean {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/u.exec(state);
  if (match === null) return false;
  const expires = Number(match[1]);
  if (expires < Math.floor(nowMs / 1000)) return false;
  const expected = replaySignature(secret, label, instance, expires);
  return timingSafeEqual(Buffer.from(match[2] ?? ""), Buffer.from(expected));
}

export function flyPeerResolver(appName: string, port: number): ResolvePeers {
  return async () => {
    const addresses = await dns.resolve6(`${appName}.internal`);
    return addresses.map((address) => `http://[${address}]:${port}`);
  };
}

function newer(
  a: { at: number; machineId: string },
  b: { at: number; machineId: string },
) {
  return a.at > b.at || (a.at === b.at && a.machineId > b.machineId);
}

export function createRegions(options: RegionsOptions): Regions {
  const { local, self, secret, log } = options;
  const now = options.now ?? Date.now;
  const refreshMs = options.refreshMs ?? PEER_REFRESH_MS;
  const lookupTimeoutMs = options.lookupTimeoutMs ?? PEER_LOOKUP_TIMEOUT_MS;
  const announceTimeoutMs =
    options.announceTimeoutMs ?? PEER_ANNOUNCE_TIMEOUT_MS;
  const helloTimeoutMs = options.helloTimeoutMs ?? PEER_HELLO_TIMEOUT_MS;
  const negativeMs = options.negativeMs ?? PEER_NEGATIVE_MS;
  const startedAt = now();
  const auth = `Bearer ${secret}`;
  const peers = new Map<string, Peer>();
  const held = new Map<string, number>();
  const holders = new Map<string, Holder>();
  const negative = new Map<string, number>();
  const asking = new Map<string, Promise<void>>();
  const waiters = new Map<string, Set<() => void>>();
  const presenceListeners: ((label: string, state: LabelPresence) => void)[] =
    [];
  const supersededListeners: ((label: string) => void)[] = [];
  let timer: NodeJS.Timeout | null = null;
  let refreshing: Promise<void> | null = null;

  function wake(label: string): void {
    for (const settle of [...(waiters.get(label) ?? [])]) settle();
  }

  function remoteHolder(label: string): Holder | null {
    const holder = holders.get(label);
    return holder === undefined || holder.machineId === self.machineId
      ? null
      : holder;
  }

  function superseded(label: string): boolean {
    return !held.has(label) && remoteHolder(label) !== null;
  }

  function remember(label: string, holder: Holder): boolean {
    const known = holders.get(label);
    if (known !== undefined && !newer(holder, known)) return false;
    holders.set(label, holder);
    negative.delete(label);
    wake(label);
    return true;
  }

  function others(): Peer[] {
    return [...peers.values()].filter(
      (peer) => peer.machineId !== self.machineId,
    );
  }

  async function call(
    peer: Peer,
    path: string,
    timeoutMs: number,
    body: unknown,
  ): Promise<unknown> {
    const response = await fetch(`${peer.url}${PEER_PATH}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: auth,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 204) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PeerStatusError(response.status);
    }
    return response.json();
  }

  function announceTo(
    peer: Peer,
    announcement: PeerAnnouncement,
  ): Promise<void> {
    return call(peer, "/announce", announceTimeoutMs, announcement).then(
      () => {},
      (error: unknown) => {
        log("warn", "peer_announce_failed", {
          peer: peer.machineId ?? peer.url,
          label: announcement.label,
          error: errorText(error),
        });
      },
    );
  }

  function broadcast(announcement: PeerAnnouncement): Promise<void> {
    return Promise.all(
      others().map((peer) => announceTo(peer, announcement)),
    ).then(() => {});
  }

  async function sayGoodbye(
    peer: Peer,
    labels: string[],
    at: number,
  ): Promise<void> {
    try {
      await call(peer, "/goodbye", announceTimeoutMs, {
        machineId: self.machineId,
        at,
      } satisfies PeerGoodbye);
    } catch (error) {
      if (!(error instanceof PeerStatusError) || error.status !== 404) {
        log("warn", "peer_goodbye_failed", {
          peer: peer.machineId ?? peer.url,
          error: errorText(error),
        });
        return;
      }
      await Promise.all(
        labels.map((label) =>
          announceTo(peer, {
            label,
            machineId: self.machineId,
            region: self.region,
            state: "disconnected",
            at,
          }),
        ),
      );
    }
  }

  function announce(label: string, state: LabelPresence, at: number) {
    return broadcast({
      label,
      machineId: self.machineId,
      region: self.region,
      state,
      at,
    });
  }

  function forget(machineId: string): void {
    for (const [label, holder] of holders) {
      if (holder.machineId === machineId) holders.delete(label);
    }
  }

  async function hello(peer: Peer): Promise<void> {
    let answer: unknown;
    try {
      answer = await call(peer, "/hello", helloTimeoutMs, {
        machineId: self.machineId,
        region: self.region,
        startedAt,
      } satisfies PeerHello);
    } catch (error) {
      log("warn", "peer_hello_failed", {
        peer: peer.url,
        error: errorText(error),
      });
      return;
    }
    const snapshot = parseSnapshot(answer);
    if (snapshot === null || peers.get(peer.url) !== peer) return;
    peer.machineId = snapshot.machineId;
    if (snapshot.machineId === self.machineId) return;
    for (const entry of snapshot.labels) {
      receive({
        label: entry.label,
        machineId: snapshot.machineId,
        region: snapshot.region,
        state: "connected",
        at: entry.at,
      });
    }
  }

  async function refreshOnce(): Promise<void> {
    let urls: string[];
    try {
      urls = await options.resolvePeers();
    } catch (error) {
      log("warn", "peer_discovery_failed", { error: errorText(error) });
      return;
    }
    const current = new Set(urls);
    for (const [url, peer] of peers) {
      if (current.has(url)) continue;
      peers.delete(url);
      if (peer.machineId !== null && peer.machineId !== self.machineId) {
        forget(peer.machineId);
        log("info", "peer_gone", { peer: peer.machineId });
      }
    }
    const unknown: Peer[] = [];
    for (const url of current) {
      const known = peers.get(url);
      if (known !== undefined && known.machineId !== null) continue;
      const peer = known ?? { url, machineId: null };
      peers.set(url, peer);
      unknown.push(peer);
    }
    await Promise.all(unknown.map(hello));
  }

  function refresh(): Promise<void> {
    refreshing ??= refreshOnce().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function receive(announcement: PeerAnnouncement): void {
    const { label, machineId } = announcement;
    if (machineId === self.machineId) return;
    if (announcement.state === "disconnected") {
      const known = holders.get(label);
      if (
        known !== undefined &&
        known.machineId === machineId &&
        announcement.at >= known.at
      ) {
        holders.delete(label);
      }
      return;
    }
    const holder = {
      machineId,
      region: announcement.region,
      at: announcement.at,
    };
    const mine = held.get(label);
    if (mine !== undefined) {
      if (!newer(holder, { at: mine, machineId: self.machineId })) {
        void announce(label, "connected", mine);
        return;
      }
      held.delete(label);
      holders.set(label, holder);
      negative.delete(label);
      log("info", "tunnel_superseded", {
        label,
        by: machineId,
        region: announcement.region,
      });
      for (const listener of supersededListeners) listener(label);
      wake(label);
      return;
    }
    remember(label, holder);
  }

  async function ask(label: string): Promise<void> {
    const answers = await Promise.all(
      others().map((peer) =>
        call(peer, `/labels/${label}`, lookupTimeoutMs, undefined).then(
          (value) => parseLabelAnswer(value),
          () => null,
        ),
      ),
    );
    let best: Holder | null = null;
    for (const answer of answers) {
      if (answer === null || !answer.held) continue;
      if (answer.machineId === self.machineId) continue;
      const holder = {
        machineId: answer.machineId,
        region: answer.region,
        at: answer.at,
      };
      if (best === null || newer(holder, best)) best = holder;
    }
    if (best !== null) {
      remember(label, best);
      return;
    }
    if (remoteHolder(label) === null) negative.set(label, now() + negativeMs);
  }

  function locate(subdomain: string): TunnelLocation {
    const label = labelOf(subdomain);
    const remote = remoteHolder(label);
    if (local.locate(subdomain).kind === "here") {
      return remote !== null && !held.has(label)
        ? { kind: "elsewhere", instance: remote.machineId }
        : { kind: "here" };
    }
    if (held.has(label) || remote === null) return { kind: "offline" };
    return { kind: "elsewhere", instance: remote.machineId };
  }

  local.onLabelPresence((label, state) => {
    if (state === "connected") {
      const at = now();
      held.set(label, at);
      if (remoteHolder(label) !== null) holders.delete(label);
      negative.delete(label);
      void announce(label, "connected", at);
      for (const listener of presenceListeners) listener(label, state);
      return;
    }
    const wasHeld = held.delete(label);
    if (wasHeld) void announce(label, "disconnected", now());
    if (!wasHeld && remoteHolder(label) !== null) return;
    for (const listener of presenceListeners) listener(label, state);
  });

  const directory: TunnelDirectory = {
    connected: (proxy) => local.connected(proxy),
    disconnected: (proxy) => local.disconnected(proxy),
    removed: (subdomain) => local.removed(subdomain),
    locate,
    async lookup(subdomain, lookup) {
      const label = labelOf(subdomain);
      if (lookup.fresh && !held.has(label)) {
        if (remoteHolder(label) !== null) holders.delete(label);
        negative.delete(label);
      }
      const located = locate(subdomain);
      if (located.kind !== "offline" || held.has(label)) return located;
      if ((negative.get(label) ?? 0) > now()) return located;
      let pending = asking.get(label);
      if (pending === undefined) {
        pending = ask(label).finally(() => asking.delete(label));
        asking.set(label, pending);
      }
      await pending;
      return locate(subdomain);
    },
    async awaitReturn(subdomain, signal) {
      const label = labelOf(subdomain);
      const located = locate(subdomain);
      if (located.kind !== "offline") return located;
      const controller = new AbortController();
      const stop = () => controller.abort();
      signal.addEventListener("abort", stop);
      const set = waiters.get(label) ?? new Set<() => void>();
      waiters.set(label, set);
      set.add(stop);
      try {
        await local.awaitReturn(subdomain, controller.signal);
      } finally {
        signal.removeEventListener("abort", stop);
        set.delete(stop);
        if (set.size === 0) waiters.delete(label);
      }
      return locate(subdomain);
    },
    onlineLabels: () =>
      local.onlineLabels().filter((label) => !superseded(label)),
    onLabelPresence(listener) {
      presenceListeners.push(listener);
    },
  };

  const routing: PeerRouting = {
    machineId: self.machineId,
    replayHeader(label, instance) {
      return `instance=${instance};state=${replayState(secret, label, instance, now())}`;
    },
    isReplay(headers, label) {
      const state = replayStateFrom(single(headers, REPLAY_SOURCE_HEADER));
      return (
        state !== null &&
        verifyReplayState(secret, state, label, self.machineId, now())
      );
    },
    peer(instance) {
      const peer = others().find((entry) => entry.machineId === instance);
      if (peer === undefined) return null;
      const url = new URL(peer.url);
      return {
        host: url.hostname.replace(/^\[|\]$/gu, ""),
        port: Number(url.port || "80"),
        auth,
      };
    },
    missed(label) {
      if (held.has(label)) return;
      void announce(label, "disconnected", now());
    },
  };

  return {
    directory,
    routing,
    onSuperseded(listener) {
      supersededListeners.push(listener);
    },
    authorized: (header) => bearerMatches(header, secret),
    receive,
    answerLabel(label) {
      const at = held.get(label);
      return at === undefined
        ? { held: false, machineId: self.machineId }
        : { held: true, machineId: self.machineId, region: self.region, at };
    },
    answerHello(greeting) {
      if (greeting.machineId !== self.machineId) {
        for (const [label, holder] of holders) {
          if (
            holder.machineId === greeting.machineId &&
            holder.at < greeting.startedAt
          ) {
            holders.delete(label);
          }
        }
        const known = [...peers.values()].some(
          (peer) => peer.machineId === greeting.machineId,
        );
        if (!known) void refresh();
      }
      return {
        machineId: self.machineId,
        region: self.region,
        labels: [...held].map(([label, at]) => ({ label, at })),
      };
    },
    peerCount: () => others().length,
    async start() {
      await refresh();
      timer = setInterval(() => void refresh(), refreshMs);
      timer.unref();
    },
    receiveGoodbye(goodbye) {
      if (goodbye.machineId === self.machineId) return;
      for (const [label, holder] of holders) {
        if (holder.machineId === goodbye.machineId && holder.at <= goodbye.at) {
          holders.delete(label);
        }
      }
    },
    async stop(timeoutMs) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      const labels = [...held.keys()];
      held.clear();
      const at = now();
      const goodbyes =
        labels.length === 0
          ? []
          : others().map((peer) => sayGoodbye(peer, labels, at));
      await Promise.race([
        Promise.all(goodbyes),
        new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
      ]);
    },
  };
}
