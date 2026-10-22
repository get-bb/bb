import type { GatePresenceRequest } from "@bb/tunnel-contract/next";
import type { AccountApi } from "./account-api.js";
import type { LabelPresence, TunnelDirectory } from "./directory.js";
import { errorText, type Log } from "./log.js";

export interface PresenceOptions {
  accounts: AccountApi;
  directory: TunnelDirectory;
  region: string;
  gateMachineId: string;
  refreshMs: number;
  flushMs?: number;
  log: Log;
  now?: () => number;
  random?: () => number;
}

interface PendingReport {
  state: LabelPresence;
  at: number;
}

const DEFAULT_FLUSH_MS = 1_000;
const FIRST_REFRESH_MIN = 0.5;
const REFRESH_JITTER = 0.1;
const MAX_BACKOFF_MS = 30_000;

export function startPresence(options: PresenceOptions) {
  const { accounts, directory, log } = options;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
  const pending = new Map<string, PendingReport>();
  const due = new Map<string, number>();
  let failures = 0;
  let retryAt = 0;
  let stopped = false;
  let running: Promise<void> | null = null;

  function queue(label: string, report: PendingReport): void {
    const queued = pending.get(label);
    if (queued === undefined || queued.at <= report.at) {
      pending.set(label, report);
    }
  }

  function toRequest(
    label: string,
    report: PendingReport,
  ): GatePresenceRequest {
    return {
      label,
      state: report.state,
      region: options.region,
      gateMachineId: options.gateMachineId,
      at: report.at,
    };
  }

  async function send(batch: [string, PendingReport][]): Promise<boolean> {
    try {
      const results = await accounts.presence(
        batch.map(([label, report]) => toRequest(label, report)),
      );
      const unknown = batch.filter(
        (_, index) => results[index] === "unknown_label",
      );
      if (unknown.length > 0) {
        log("warn", "presence_unknown_labels", {
          first: unknown[0]?.[0] ?? null,
          count: unknown.length,
        });
      }
      return true;
    } catch (error) {
      log("warn", "presence_failed", {
        reports: batch.length,
        error: errorText(error),
      });
      return false;
    }
  }

  async function drain(force: boolean): Promise<void> {
    while (pending.size > 0 && (force || now() >= retryAt)) {
      const batch = [...pending];
      pending.clear();
      if (await send(batch)) {
        failures = 0;
        retryAt = 0;
        continue;
      }
      for (const [label, report] of batch) queue(label, report);
      failures += 1;
      retryAt = now() + Math.min(flushMs * 2 ** failures, MAX_BACKOFF_MS);
      return;
    }
  }

  function flush(force = false): Promise<void> {
    if (running !== null) return running;
    running = drain(force).finally(() => {
      running = null;
    });
    return running;
  }

  function nextRefresh(first: boolean): number {
    const spread = first
      ? FIRST_REFRESH_MIN + (1 - FIRST_REFRESH_MIN) * random()
      : 1 - REFRESH_JITTER * random();
    return now() + options.refreshMs * spread;
  }

  function tick(): void {
    const at = now();
    for (const [label, when] of due) {
      if (when > at) continue;
      if (!pending.has(label)) queue(label, { state: "connected", at });
      due.set(label, nextRefresh(false));
    }
    void flush();
  }

  directory.onLabelPresence((label, state) => {
    if (stopped) return;
    queue(label, { state, at: now() });
    if (state === "connected") due.set(label, nextRefresh(true));
    else due.delete(label);
  });
  const timer = setInterval(tick, flushMs);
  timer.unref();

  return {
    async settle(): Promise<void> {
      if (running !== null) await running;
      await flush(true);
    },
    async stop(timeoutMs: number): Promise<void> {
      stopped = true;
      clearInterval(timer);
      const at = now();
      const goodbyes = directory
        .onlineLabels()
        .map((label): [string, PendingReport] => [
          label,
          { state: "disconnected", at },
        ]);
      pending.clear();
      due.clear();
      const sent =
        goodbyes.length === 0
          ? Promise.resolve()
          : accounts
              .presence(
                goodbyes.map(([label, report]) => toRequest(label, report)),
              )
              .then(
                () => {},
                (error: unknown) => {
                  log("warn", "presence_failed", {
                    reports: goodbyes.length,
                    error: errorText(error),
                  });
                },
              );
      await Promise.race([
        sent,
        new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
      ]);
    },
  };
}
