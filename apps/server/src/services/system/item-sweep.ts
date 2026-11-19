import {
  deleteSweepItemFailures,
  getSweepItemFailure,
  listSweepItemFailures,
  persistedRetryExhausted,
  upsertSweepItemFailure,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  SWEEP_ITEM_RETRY_DELAYS_MS,
  nextSlowPersistedRetryAt,
} from "../lib/persisted-retry.js";

const FORGET_UNLISTED_FAILURE_AFTER_MS = 60 * 60_000;
const ITEM_DETACH_AFTER_MS = 60_000;
const YIELD_AFTER_MS = 8;

export type SweepDeps = Pick<AppDeps, "db" | "logger">;

export interface ItemSweepDefinition<T> {
  name: string;
  concurrency: number;
  list(args: {
    excludedKeys: ReadonlySet<string>;
  }): readonly T[] | Promise<readonly T[]>;
  key(item: T): string;
  process(item: T): void | Promise<void>;
}

export interface ItemSweep {
  readonly name: string;
  run(deps: SweepDeps, now: number): Promise<void>;
}

export function defineItemSweep<T>(
  definition: ItemSweepDefinition<T>,
): ItemSweep {
  return {
    name: definition.name,
    run: (deps, now) => runItemSweep(deps, definition, { now, relist: false }),
  };
}

export function defineScanSweep<T>(
  definition: ItemSweepDefinition<T>,
): ItemSweep {
  return {
    name: definition.name,
    run: (deps, now) => runItemSweep(deps, definition, { now, relist: true }),
  };
}

export function defineSingleItemSweep(definition: {
  name: string;
  process(): void | Promise<void>;
}): ItemSweep {
  return defineItemSweep({
    name: definition.name,
    concurrency: 1,
    list: () => [definition.name],
    key: (itemKey) => itemKey,
    process: () => definition.process(),
  });
}

function recordSweepFailure(
  deps: SweepDeps,
  args: { error: unknown; itemKey: string; now: number; sweep: string },
): void {
  const previous = getSweepItemFailure(deps.db, args);
  const attempts = (previous?.attempts ?? 0) + 1;
  const retryAt = nextSlowPersistedRetryAt(
    SWEEP_ITEM_RETRY_DELAYS_MS,
    attempts,
    args.now,
  );
  upsertSweepItemFailure(deps.db, {
    attempts,
    firstFailedAt: previous?.firstFailedAt ?? args.now,
    itemKey: args.itemKey,
    lastError:
      args.error instanceof Error ? args.error.message : String(args.error),
    retryAt,
    sweep: args.sweep,
  });
  const log = {
    attempts,
    err: args.error,
    itemKey: args.itemKey,
    retryAt,
    sweep: args.sweep,
  };
  if (attempts === SWEEP_ITEM_RETRY_DELAYS_MS.length + 1) {
    deps.logger.error(
      log,
      "Sweep item needs recovery; retrying hourly until it succeeds or bb server sweeps retry",
    );
  } else if (persistedRetryExhausted(SWEEP_ITEM_RETRY_DELAYS_MS, attempts)) {
    deps.logger.warn(log, "Sweep item still needs recovery; retrying hourly");
  } else {
    deps.logger.warn(log, "Sweep item failed; retrying later");
  }
}

function clearSweepFailure(
  deps: SweepDeps,
  args: { itemKey: string; sweep: string },
): void {
  deleteSweepItemFailures(deps.db, {
    itemKeys: [args.itemKey],
    sweep: args.sweep,
  });
}

const inFlightBySweep = new Map<string, Set<string>>();

function inFlightKeys(sweep: string): Set<string> {
  let keys = inFlightBySweep.get(sweep);
  if (keys === undefined) {
    keys = new Set();
    inFlightBySweep.set(sweep, keys);
  }
  return keys;
}

async function runItemSweep<T>(
  deps: SweepDeps,
  definition: ItemSweepDefinition<T>,
  args: { now: number; relist: boolean },
): Promise<void> {
  const { now } = args;
  const sweep = definition.name;
  const failures = new Map(
    listSweepItemFailures(deps.db, sweep).map((failure) => [
      failure.itemKey,
      failure,
    ]),
  );
  const inFlight = inFlightKeys(sweep);
  const backingOff = [...failures.values()]
    .filter((failure) => failure.retryAt > now)
    .map((failure) => failure.itemKey);
  const failedThisPass = new Set<string>();
  const started = new Set<string>();
  const listedKeys = new Set<string>();
  let lastYieldAt = performance.now();
  for (;;) {
    const excludedKeys = new Set([
      ...backingOff,
      ...inFlight,
      ...failedThisPass,
    ]);
    const due: Array<{ item: T; itemKey: string }> = [];
    for (const item of await definition.list({ excludedKeys })) {
      const itemKey = definition.key(item);
      listedKeys.add(itemKey);
      if (excludedKeys.has(itemKey) || started.has(itemKey)) continue;
      started.add(itemKey);
      due.push({ item, itemKey });
    }
    if (due.length === 0) break;
    let next = 0;
    const worker = async () => {
      for (let entry = due[next]; entry !== undefined; entry = due[next]) {
        next += 1;
        if (performance.now() - lastYieldAt >= YIELD_AFTER_MS) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          lastYieldAt = performance.now();
        }
        if (inFlight.has(entry.itemKey)) continue;
        const outcome = await runItem(deps, definition, {
          hadFailure: failures.has(entry.itemKey),
          inFlight,
          item: entry.item,
          itemKey: entry.itemKey,
          now,
        });
        if (outcome === "failed") failedThisPass.add(entry.itemKey);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(definition.concurrency, due.length)) },
        worker,
      ),
    );
    if (!args.relist) break;
  }
  deleteSweepItemFailures(deps.db, {
    itemKeys: [...failures.values()]
      .filter(
        (failure) =>
          failure.retryAt <= now - FORGET_UNLISTED_FAILURE_AFTER_MS &&
          !listedKeys.has(failure.itemKey) &&
          !inFlight.has(failure.itemKey),
      )
      .map((failure) => failure.itemKey),
    sweep,
  });
}

async function runItem<T>(
  deps: SweepDeps,
  definition: ItemSweepDefinition<T>,
  args: {
    hadFailure: boolean;
    inFlight: Set<string>;
    item: T;
    itemKey: string;
    now: number;
  },
): Promise<"detached" | "failed" | "succeeded"> {
  const sweep = definition.name;
  const { itemKey } = args;
  args.inFlight.add(itemKey);
  const startedAt = Date.now();
  let ranPastDetach = false;
  const settled = Promise.resolve()
    .then(() => definition.process(args.item))
    .then(
      () => {
        if (args.hadFailure) clearSweepFailure(deps, { itemKey, sweep });
        return "succeeded" as const;
      },
      (error: unknown) => {
        recordSweepFailure(deps, {
          error,
          itemKey,
          now: ranPastDetach
            ? args.now + Math.max(0, Date.now() - startedAt)
            : args.now,
          sweep,
        });
        return "failed" as const;
      },
    )
    .catch((error: unknown) => {
      deps.logger.error(
        { err: error, itemKey, sweep },
        "Sweep item outcome could not be recorded",
      );
      return "failed" as const;
    })
    .finally(() => {
      args.inFlight.delete(itemKey);
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const detached = new Promise<"detached">((resolve) => {
    timer = setTimeout(() => {
      ranPastDetach = true;
      resolve("detached");
    }, ITEM_DETACH_AFTER_MS);
    timer.unref();
  });
  const outcome = await Promise.race([settled, detached]);
  clearTimeout(timer);
  if (outcome === "detached") {
    deps.logger.warn(
      { detachAfterMs: ITEM_DETACH_AFTER_MS, itemKey, sweep },
      "Sweep item is still running; continuing without waiting for it",
    );
  }
  return outcome;
}
