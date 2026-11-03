import { createHash } from "node:crypto";
import {
  GATE_PRESENCE_BATCH_MAX,
  GATE_PRESENCE_BATCH_PATH,
  GATE_RESOLVE_BATCH_MAX,
  GATE_RESOLVE_BATCH_PATH,
  type GateAssertionOAuth,
  type GatePresenceRequest,
  type GatePresenceResult,
  type GateResolveRequest,
  type GateResolveResponse,
  type GateResolvedLabel,
} from "@bb/tunnel-contract/next";
import { Lru } from "./lru.js";

export interface ResolveOptions {
  deadlineMs?: number;
}

export interface AccountApi {
  resolve(
    request: GateResolveRequest,
    options?: ResolveOptions,
  ): Promise<GateResolveResponse>;
  forget(request: GateResolveRequest): void;
  presence(reports: GatePresenceRequest[]): Promise<GatePresenceResult[]>;
}

export interface AccountApiOptions {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  maxStaleMs?: number;
  maxEntries?: number;
  batchWindowMs?: number;
  backgroundWindowMs?: number;
  maxBatchesInFlight?: number;
  deadlineMs?: number;
  now?: () => number;
  random?: () => number;
  fetch?: typeof fetch;
  onRevalidateFailed?: (error: unknown) => void;
}

export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POSITIVE_TTL_MS = 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 5_000;
const DEFAULT_MAX_STALE_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_BATCH_WINDOW_MS = 5;
const DEFAULT_BACKGROUND_WINDOW_MS = 500;
const DEFAULT_MAX_BATCHES_IN_FLIGHT = 16;
const DEFAULT_DEADLINE_MS = 10_000;
const MAX_POSITIVE_TTL_MS = 60_000;
const TTL_JITTER = 0.2;
const REVALIDATE_RETRY_MS = 5_000;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableTime(value: unknown): value is number | null {
  return (
    value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function parseLabel(value: unknown): GateResolvedLabel | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { kind, userId, revoked, lastSeenAt } = value;
  if (!isId(userId) || typeof revoked !== "boolean") return undefined;
  if (!isNullableTime(lastSeenAt)) return undefined;
  if (kind === "server" && isId(value.serverId)) {
    return { kind, serverId: value.serverId, userId, revoked, lastSeenAt };
  }
  const { machineId, accountHandle, routingKey } = value;
  if (
    kind === "machine" &&
    isId(machineId) &&
    isId(accountHandle) &&
    isId(routingKey)
  ) {
    return {
      kind,
      machineId,
      userId,
      accountHandle,
      routingKey,
      revoked,
      lastSeenAt,
    };
  }
  return undefined;
}

function parseSession(
  value: unknown,
): GateResolveResponse["session"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isId(value.userId)) return undefined;
  if (typeof value.needsRefresh !== "boolean") return undefined;
  return { userId: value.userId, needsRefresh: value.needsRefresh };
}

function parseDesktopSession(
  value: unknown,
): GateResolveResponse["desktopSession"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isId(value.userId)) return undefined;
  const { setCookie } = value;
  if (
    setCookie !== null &&
    (typeof setCookie !== "string" || setCookie === "")
  ) {
    return undefined;
  }
  return { userId: value.userId, setCookie };
}

function parseMachine(
  value: unknown,
): { machineId: string; userId: string } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isId(value.machineId) || !isId(value.userId)) {
    return undefined;
  }
  return { machineId: value.machineId, userId: value.userId };
}

function parseOAuth(value: unknown): GateAssertionOAuth | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { scope, grantId, clientName } = value;
  if (!isId(scope) || !isId(grantId) || typeof clientName !== "string") {
    return undefined;
  }
  return { scope, grantId, clientName };
}

const RESPONSE_KEYS = [
  "label",
  "session",
  "desktopSession",
  "credential",
  "machine",
  "oauth",
] as const;

export function parseGateResolveResponse(
  value: unknown,
  request: GateResolveRequest,
): GateResolveResponse | null {
  if (!isRecord(value)) return null;
  if (!RESPONSE_KEYS.every((key) => key in value)) return null;
  const label = parseLabel(value.label);
  const session = parseSession(value.session);
  const desktopSession = parseDesktopSession(value.desktopSession);
  const machine = parseMachine(value.machine);
  const oauth = parseOAuth(value.oauth);
  const { credential } = value;
  if (
    label === undefined ||
    session === undefined ||
    desktopSession === undefined ||
    machine === undefined ||
    oauth === undefined ||
    (credential !== null && typeof credential !== "boolean")
  ) {
    return null;
  }
  const unasked =
    (request.session === null && session !== null) ||
    (request.desktopSession === null && desktopSession !== null) ||
    (request.credential === null && credential !== null) ||
    (request.machineCredential === null && machine !== null) ||
    (request.oauth === null && oauth !== null);
  if (unasked) return null;
  return { label, session, desktopSession, credential, machine, oauth };
}

export function isPositiveAnswer(
  request: GateResolveRequest,
  answer: GateResolveResponse,
): boolean {
  if (answer.label === null || answer.label.revoked) return false;
  if (request.session !== null && answer.session === null) return false;
  if (request.desktopSession !== null && answer.desktopSession === null) {
    return false;
  }
  if (request.credential !== null && answer.credential !== true) return false;
  if (request.machineCredential !== null && answer.machine === null) {
    return false;
  }
  return !(request.oauth !== null && answer.oauth === null);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function cacheKey(request: GateResolveRequest): string {
  return digest(
    JSON.stringify([
      request.label,
      request.session,
      request.desktopSession,
      request.credential,
      request.machineCredential,
      request.oauth?.token ?? null,
      request.oauth?.resource ?? null,
    ]),
  );
}

function factsOf(request: GateResolveRequest): string[] {
  const facts = [`label:${request.label}`];
  if (request.session !== null)
    facts.push(`session:${digest(request.session)}`);
  if (request.desktopSession !== null) {
    facts.push(`desktop:${digest(request.desktopSession)}`);
  }
  if (request.credential !== null) {
    facts.push(`credential:${digest(request.credential)}`);
  }
  if (request.machineCredential !== null) {
    facts.push(`machine:${digest(request.machineCredential)}`);
  }
  if (request.oauth !== null)
    facts.push(`oauth:${digest(request.oauth.token)}`);
  return facts;
}

export function refutedFacts(
  request: GateResolveRequest,
  answer: GateResolveResponse,
): string[] {
  const refuted: string[] = [];
  if (answer.label === null || answer.label.revoked) {
    refuted.push(`label:${request.label}`);
  }
  if (request.session !== null && answer.session === null) {
    refuted.push(`session:${digest(request.session)}`);
  }
  if (request.desktopSession !== null && answer.desktopSession === null) {
    refuted.push(`desktop:${digest(request.desktopSession)}`);
  }
  if (request.credential !== null && answer.credential !== true) {
    refuted.push(`credential:${digest(request.credential)}`);
  }
  if (request.machineCredential !== null && answer.machine === null) {
    refuted.push(`machine:${digest(request.machineCredential)}`);
  }
  if (request.oauth !== null && answer.oauth === null) {
    refuted.push(`oauth:${digest(request.oauth.token)}`);
  }
  return refuted;
}

interface Entry {
  request: GateResolveRequest;
  answer: GateResolveResponse;
  positive: boolean;
  freshUntil: number;
  facts: string[];
  revalidating: boolean;
  retryAt: number;
}

interface Queued {
  request: GateResolveRequest;
  resolve(answer: GateResolveResponse): void;
  reject(error: unknown): void;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export function createAccountApi(options: AccountApiOptions): AccountApi {
  const baseUrl = options.baseUrl.replace(/\/+$/u, "");
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const positiveTtlMs = Math.min(
    options.positiveTtlMs ?? DEFAULT_POSITIVE_TTL_MS,
    MAX_POSITIVE_TTL_MS,
  );
  const negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
  const maxStaleMs = Math.max(
    options.maxStaleMs ?? DEFAULT_MAX_STALE_MS,
    positiveTtlMs,
  );
  const batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
  const backgroundWindowMs =
    options.backgroundWindowMs ?? DEFAULT_BACKGROUND_WINDOW_MS;
  const maxBatchesInFlight =
    options.maxBatchesInFlight ?? DEFAULT_MAX_BATCHES_IN_FLIGHT;
  const defaultDeadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const byFact = new Map<string, Set<string>>();
  const answers = new Lru<Entry>({
    maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxBytes: Number.POSITIVE_INFINITY,
    sizeOf: () => 1,
    onDelete: (key, entry) => {
      for (const fact of entry.facts) {
        const keys = byFact.get(fact);
        keys?.delete(key);
        if (keys?.size === 0) byFact.delete(fact);
      }
    },
  });
  const inFlight = new Map<string, Promise<GateResolveResponse>>();
  const urgent: Queued[] = [];
  const background: Queued[] = [];
  let batchesInFlight = 0;
  let flushTimer: NodeJS.Timeout | null = null;
  let flushAt = 0;

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new AccountApiError(
        `account API ${path} unreachable: ${error instanceof Error ? error.name : "error"}`,
        true,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AccountApiError(
        `account API ${path} answered HTTP ${response.status}`,
        isTransientStatus(response.status),
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AccountApiError(
        `account API ${path} answered invalid JSON`,
        true,
      );
    }
  }

  async function sendBatch(batch: Queued[]): Promise<void> {
    let body: unknown;
    try {
      body = await post(GATE_RESOLVE_BATCH_PATH, {
        requests: batch.map((queued) => queued.request),
      });
    } catch (error) {
      for (const queued of batch) queued.reject(error);
      return;
    }
    const list =
      isRecord(body) && Array.isArray(body.answers) ? body.answers : null;
    if (list === null || list.length !== batch.length) {
      const error = new AccountApiError(
        "account API resolve batch answer is malformed",
        false,
      );
      for (const queued of batch) queued.reject(error);
      return;
    }
    for (const [index, queued] of batch.entries()) {
      const raw: unknown = list[index];
      if (raw === null) {
        queued.reject(
          new AccountApiError("account API could not check this", true),
        );
        continue;
      }
      const answer = parseGateResolveResponse(raw, queued.request);
      if (answer === null) {
        queued.reject(
          new AccountApiError("account API resolve answer is malformed", false),
        );
        continue;
      }
      queued.resolve(answer);
    }
  }

  function flush(): void {
    flushTimer = null;
    while (
      batchesInFlight < maxBatchesInFlight &&
      urgent.length + background.length > 0
    ) {
      const batch = urgent.splice(0, GATE_RESOLVE_BATCH_MAX);
      batch.push(
        ...background.splice(0, GATE_RESOLVE_BATCH_MAX - batch.length),
      );
      batchesInFlight += 1;
      void sendBatch(batch).finally(() => {
        batchesInFlight -= 1;
        schedule();
      });
    }
  }

  function schedule(): void {
    if (urgent.length + background.length === 0) return;
    const delay =
      urgent.length > 0 || background.length >= GATE_RESOLVE_BATCH_MAX
        ? batchWindowMs
        : backgroundWindowMs;
    const at = Date.now() + delay;
    if (flushTimer !== null) {
      if (flushAt <= at) return;
      clearTimeout(flushTimer);
    }
    flushAt = at;
    flushTimer = setTimeout(flush, delay);
    flushTimer.unref();
  }

  function enqueue(
    request: GateResolveRequest,
    lane: Queued[],
  ): Promise<GateResolveResponse> {
    return new Promise((resolve, reject) => {
      lane.push({ request, resolve, reject });
      schedule();
    });
  }

  async function lookup(
    request: GateResolveRequest,
    deadlineMs: number,
  ): Promise<GateResolveResponse> {
    const deadline = Date.now() + deadlineMs;
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadline - Date.now();
      let timer: NodeJS.Timeout | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AccountApiError("account API did not answer in time", true),
            ),
          Math.max(0, remaining),
        );
      });
      try {
        return await Promise.race([enqueue(request, urgent), expired]);
      } catch (error) {
        const transient =
          !(error instanceof AccountApiError) || error.transient;
        const backoff = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
        const wait = backoff * (0.5 + random());
        if (!transient || Date.now() + wait >= deadline) throw error;
        await sleep(wait);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  function jittered(ttl: number): number {
    return ttl * (1 - TTL_JITTER * random());
  }

  function store(
    key: string,
    request: GateResolveRequest,
    answer: GateResolveResponse,
  ): void {
    const at = now();
    for (const fact of refutedFacts(request, answer)) {
      for (const stale of [...(byFact.get(fact) ?? [])]) answers.delete(stale);
    }
    const positive = isPositiveAnswer(request, answer);
    const freshUntil = at + jittered(positive ? positiveTtlMs : negativeTtlMs);
    const facts = factsOf(request);
    answers.set(
      key,
      {
        request,
        answer,
        positive,
        freshUntil,
        facts,
        revalidating: false,
        retryAt: 0,
      },
      positive ? at + maxStaleMs : freshUntil,
    );
    if (answers.peek(key) === undefined) return;
    for (const fact of facts) {
      const keys = byFact.get(fact) ?? new Set<string>();
      keys.add(key);
      byFact.set(fact, keys);
    }
  }

  function revalidate(key: string, entry: Entry): void {
    if (entry.revalidating || now() < entry.retryAt) return;
    entry.revalidating = true;
    enqueue(entry.request, background).then(
      (answer) => {
        if (answers.peek(key) === entry) store(key, entry.request, answer);
      },
      (error: unknown) => {
        entry.revalidating = false;
        entry.retryAt = now() + REVALIDATE_RETRY_MS;
        options.onRevalidateFailed?.(error);
      },
    );
  }

  return {
    resolve(request, resolveOptions = {}) {
      const key = cacheKey(request);
      const entry = answers.get(key, now());
      if (entry !== undefined) {
        if (now() < entry.freshUntil) return Promise.resolve(entry.answer);
        if (entry.positive) {
          revalidate(key, entry);
          return Promise.resolve(entry.answer);
        }
      }
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;
      const started = lookup(
        request,
        resolveOptions.deadlineMs ?? defaultDeadlineMs,
      )
        .then((answer) => {
          store(key, request, answer);
          return answer;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, started);
      return started;
    },
    forget(request) {
      answers.delete(cacheKey(request));
    },
    async presence(reports) {
      const chunks: GatePresenceRequest[][] = [];
      for (
        let start = 0;
        start < reports.length;
        start += GATE_PRESENCE_BATCH_MAX
      ) {
        chunks.push(reports.slice(start, start + GATE_PRESENCE_BATCH_MAX));
      }
      const answered = await Promise.all(
        chunks.map(async (chunk) => {
          const body = await post(GATE_PRESENCE_BATCH_PATH, { reports: chunk });
          const list =
            isRecord(body) && Array.isArray(body.results) ? body.results : null;
          if (
            list === null ||
            list.length !== chunk.length ||
            !list.every(
              (result: unknown): result is GatePresenceResult =>
                result === "recorded" ||
                result === "unchanged" ||
                result === "unknown_label",
            )
          ) {
            throw new AccountApiError(
              "account API presence answer is malformed",
              false,
            );
          }
          return list;
        }),
      );
      return answered.flat();
    },
  };
}
