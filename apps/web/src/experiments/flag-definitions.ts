import { parseFlagDefinitions, type FlagDefinitions } from "./local-flags";

const FRESH_MS = 30 * 1000;
const MAX_STALE_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const FETCHED_AT_HEADER = "x-bb-fetched-at";

type DefinitionsOutcome =
  | "ok"
  | "not_modified"
  | "timeout"
  | "error"
  | "http_error"
  | "invalid_response";

export type DefinitionsLogEntry = {
  event: "posthog_flag_definitions";
  outcome: DefinitionsOutcome;
  duration_ms: number;
  status?: number;
};

type Entry = {
  definitions: FlagDefinitions;
  body: string;
  etag: string | null;
  fetchedAt: number;
};

export type SharedCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

export type FlagDefinitionsConfig = {
  host: string;
  projectKey: string;
  secretKey: string;
  cacheKey: string;
  fetch: typeof fetch;
  log: (entry: DefinitionsLogEntry) => void;
  sharedCache?: SharedCache;
  now?: () => number;
};

export type FlagDefinitionsSource = {
  read: (
    waitUntil: (promise: Promise<unknown>) => void,
  ) => Promise<FlagDefinitions | null>;
};

export function createFlagDefinitionsSource(
  config: FlagDefinitionsConfig,
): FlagDefinitionsSource {
  const now = config.now ?? Date.now;
  let entry: Entry | null = null;
  let refreshing: Promise<void> | null = null;
  let lastAttemptAt = -Infinity;

  async function readShared(): Promise<Entry | null> {
    try {
      const response = await config.sharedCache?.match(config.cacheKey);
      if (!response) {
        return null;
      }
      const fetchedAt = Number(response.headers.get(FETCHED_AT_HEADER));
      const body = await response.text();
      const definitions = parseFlagDefinitions(JSON.parse(body));
      return definitions === null || !Number.isFinite(fetchedAt)
        ? null
        : { definitions, body, etag: response.headers.get("etag"), fetchedAt };
    } catch {
      return null;
    }
  }

  async function writeShared(next: Entry): Promise<void> {
    try {
      await config.sharedCache?.put(
        config.cacheKey,
        new Response(next.body, {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${MAX_STALE_MS / 1000}`,
            [FETCHED_AT_HEADER]: String(next.fetchedAt),
            ...(next.etag === null ? {} : { etag: next.etag }),
          },
        }),
      );
    } catch {
      return;
    }
  }

  async function refresh(): Promise<void> {
    const startedAt = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let outcome: DefinitionsOutcome = "error";
    let status: number | undefined;
    try {
      const response = await config.fetch(
        `${config.host.replace(/\/$/, "")}/flags/definitions?token=${encodeURIComponent(config.projectKey)}&send_cohorts`,
        {
          headers: {
            authorization: `Bearer ${config.secretKey}`,
            ...(entry?.etag ? { "if-none-match": entry.etag } : {}),
          },
          signal: controller.signal,
        },
      );
      status = response.status;
      if (response.status === 304 && entry !== null) {
        outcome = "not_modified";
        entry = { ...entry, fetchedAt: now() };
        await writeShared(entry);
      } else if (!response.ok) {
        outcome = "http_error";
      } else {
        const body = await response.text();
        const definitions = parseFlagDefinitions(JSON.parse(body));
        if (definitions === null) {
          outcome = "invalid_response";
        } else {
          outcome = "ok";
          entry = {
            definitions,
            body,
            etag: response.headers.get("etag"),
            fetchedAt: now(),
          };
          await writeShared(entry);
        }
      }
    } catch (error) {
      outcome = controller.signal.aborted
        ? "timeout"
        : error instanceof SyntaxError
          ? "invalid_response"
          : "error";
    } finally {
      clearTimeout(timer);
    }
    config.log({
      event: "posthog_flag_definitions",
      outcome,
      duration_ms: now() - startedAt,
      ...(status === undefined ? {} : { status }),
    });
  }

  function startRefresh(): Promise<void> | null {
    if (refreshing === null && now() - lastAttemptAt < FRESH_MS) {
      return null;
    }
    if (refreshing === null) {
      lastAttemptAt = now();
      refreshing = refresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  return {
    async read(waitUntil) {
      if (entry === null || now() - entry.fetchedAt >= FRESH_MS) {
        const shared = await readShared();
        if (
          shared !== null &&
          (entry === null || shared.fetchedAt > entry.fetchedAt)
        ) {
          entry = shared;
        }
      }
      const age = entry === null ? Infinity : now() - entry.fetchedAt;
      const pending = age >= FRESH_MS ? startRefresh() : null;
      if (pending !== null) {
        waitUntil(pending);
      }
      return entry !== null && age < MAX_STALE_MS ? entry.definitions : null;
    },
  };
}
