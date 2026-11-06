import {
  deleteSweepItemFailures,
  getSweepItemFailure,
  listSweepItemFailures,
  upsertSweepItemFailure,
} from "@bb/db";
import type { AppDeps } from "../../types.js";

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;
const REPEATED_FAILURE_ATTEMPTS = 5;
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
    run: (deps, now) => runItemSweep(deps, definition, now),
  };
}

export function sweepRetryDelayMs(attempts: number): number {
  return Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 16),
  );
}

export function recordSweepFailure(
  deps: SweepDeps,
  args: { error: unknown; itemKey: string; now: number; sweep: string },
): void {
  const previous = getSweepItemFailure(deps.db, args);
  const attempts = (previous?.attempts ?? 0) + 1;
  const retryInMs = sweepRetryDelayMs(attempts);
  upsertSweepItemFailure(deps.db, {
    attempts,
    firstFailedAt: previous?.firstFailedAt ?? args.now,
    itemKey: args.itemKey,
    lastError:
      args.error instanceof Error ? args.error.message : String(args.error),
    retryAt: args.now + retryInMs,
    sweep: args.sweep,
  });
  const log = {
    attempts,
    err: args.error,
    itemKey: args.itemKey,
    retryInMs,
    sweep: args.sweep,
  };
  if (attempts >= REPEATED_FAILURE_ATTEMPTS) {
    deps.logger.error(log, "Sweep item keeps failing; other items continue");
  } else {
    deps.logger.warn(log, "Sweep item failed; retrying later");
  }
}

export function clearSweepFailure(
  deps: SweepDeps,
  args: { itemKey: string; sweep: string },
): void {
  deleteSweepItemFailures(deps.db, {
    itemKeys: [args.itemKey],
    sweep: args.sweep,
  });
}

export function listBackingOffSweepItems(
  deps: SweepDeps,
  args: { now: number; sweep: string },
): Set<string> {
  return new Set(
    listSweepItemFailures(deps.db, args.sweep)
      .filter((failure) => failure.retryAt > args.now)
      .map((failure) => failure.itemKey),
  );
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
  now: number,
): Promise<void> {
  const sweep = definition.name;
  const failures = new Map(
    listSweepItemFailures(deps.db, sweep).map((failure) => [
      failure.itemKey,
      failure,
    ]),
  );
  const inFlight = inFlightKeys(sweep);
  const excludedKeys = new Set(inFlight);
  for (const failure of failures.values()) {
    if (failure.retryAt > now) excludedKeys.add(failure.itemKey);
  }
  const listedKeys = new Set<string>();
  const due: Array<{ item: T; itemKey: string }> = [];
  for (const item of await definition.list({ excludedKeys })) {
    const itemKey = definition.key(item);
    listedKeys.add(itemKey);
    if (!excludedKeys.has(itemKey)) due.push({ item, itemKey });
  }
  let next = 0;
  let lastYieldAt = performance.now();
  const worker = async () => {
    for (let entry = due[next]; entry !== undefined; entry = due[next]) {
      next += 1;
      if (performance.now() - lastYieldAt >= YIELD_AFTER_MS) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        lastYieldAt = performance.now();
      }
      await runItem(deps, definition, {
        hadFailure: failures.has(entry.itemKey),
        inFlight,
        item: entry.item,
        itemKey: entry.itemKey,
        now,
      });
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(definition.concurrency, due.length)) },
      worker,
    ),
  );
  deleteSweepItemFailures(deps.db, {
    itemKeys: [...failures.values()]
      .filter(
        (failure) =>
          failure.retryAt <= now - RETRY_MAX_MS &&
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
): Promise<void> {
  const sweep = definition.name;
  const { itemKey } = args;
  args.inFlight.add(itemKey);
  const settled = Promise.resolve()
    .then(() => definition.process(args.item))
    .then(
      () => {
        if (args.hadFailure) clearSweepFailure(deps, { itemKey, sweep });
      },
      (error: unknown) => {
        recordSweepFailure(deps, { error, itemKey, now: args.now, sweep });
      },
    )
    .catch((error: unknown) => {
      deps.logger.error(
        { err: error, itemKey, sweep },
        "Sweep item outcome could not be recorded",
      );
    })
    .finally(() => {
      args.inFlight.delete(itemKey);
    });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const detached = new Promise<"detached">((resolve) => {
    timer = setTimeout(() => resolve("detached"), ITEM_DETACH_AFTER_MS);
    timer.unref();
  });
  const outcome = await Promise.race([
    settled.then(() => "settled" as const),
    detached,
  ]);
  clearTimeout(timer);
  if (outcome === "detached") {
    deps.logger.warn(
      { detachAfterMs: ITEM_DETACH_AFTER_MS, itemKey, sweep },
      "Sweep item is still running; continuing without waiting for it",
    );
  }
}
