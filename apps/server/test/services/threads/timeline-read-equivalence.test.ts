import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFeatureFlags } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import {
  APP_SURFACE,
  buildUncachedFullTimeline,
  createRng,
  createThreadLog,
  describeRowDifference,
  EXTENSION_STATE_EVENT_LOG,
  INTERLEAVED_EVENT_LOG,
  MIXED_EVENT_LOG,
  openTimelineClient,
  pick,
  pickStateKinds,
  registerGuardProvider,
  type ClientSurface,
  type EventLogShape,
  type GuardProvider,
  type Rng,
  type ThreadLog,
  type TimelineClient,
} from "./timeline-guard-harness.js";

interface SeedRun {
  extensionStates: boolean;
  seed: number;
  shape: EventLogShape;
}

const seedRange = (
  first: number,
  count: number,
  shape: EventLogShape,
  extensionStates = false,
): SeedRun[] =>
  Array.from({ length: count }, (_, index) => ({
    extensionStates,
    seed: first + index,
    shape,
  }));

const SEED_RUNS: SeedRun[] = [
  ...seedRange(1, 16, MIXED_EVENT_LOG),
  ...seedRange(17, 7, INTERLEAVED_EVENT_LOG),
  ...[25, 26, 28, 30].map((seed) => ({
    extensionStates: true,
    seed,
    shape: EXTENSION_STATE_EVENT_LOG,
  })),
];
const OPERATIONS_PER_SEED = 70;
const PHONE_SURFACE: ClientSurface = { ...APP_SURFACE, segmentLimit: 3 };
const NESTED_SURFACE: ClientSurface = {
  deferContent: false,
  includeNestedRows: true,
  segmentLimit: 4,
};
const SURFACES = [APP_SURFACE, PHONE_SURFACE, NESTED_SURFACE];
const SMALL_WINDOWS = {
  featureFlags: { ...defaultFeatureFlags, timelineWindowEventBudget: 24 },
};

const HEAD_FIELDS = [
  "maxSeq",
  "contextBoundarySeq",
  "completedTurnDisplay",
  "activePromptMode",
  "activeThinking",
  "activeWorkflows",
  "activeBackgroundCommands",
  "pendingTodos",
  "extensionStates",
  "providerCommands",
  "sessionOptions",
  "modelFallback",
  "contextWindowUsage",
] as const satisfies readonly (keyof ThreadTimelineResponse)[];

function headFields(timeline: ThreadTimelineResponse) {
  return Object.fromEntries(HEAD_FIELDS.map((key) => [key, timeline[key]]));
}

interface Run {
  harness: TestAppHarness;
  log: ThreadLog;
  operations: string[];
  rng: Rng;
  seed: number;
}

function context(run: Run, label: string): string {
  return `seed ${run.seed}, ${label}, after: ${run.operations.slice(-12).join(" → ")}`;
}

async function expectClientMatchesFullBuild(
  run: Run,
  client: TimelineClient,
  label: string,
): Promise<void> {
  await client.walkToStart();
  const full = buildUncachedFullTimeline(
    run.harness,
    run.log.threadId,
    client.surface,
  );
  const where = context(
    run,
    `${label} (segmentLimit ${client.surface.segmentLimit})`,
  );
  const difference = describeRowDifference(client.loaded().rows, full.rows);
  expect(difference, where).toBeNull();
  expect(headFields(client.latest()), where).toEqual(headFields(full));
}

async function checkReads(run: Run, clients: TimelineClient[]): Promise<void> {
  for (const client of clients) {
    await client.deliverPushes();
    await client.refetch();
    if (client.surface.includeNestedRows) continue;
    await expectClientMatchesFullBuild(run, client, "long-lived client");
  }
  for (const surface of SURFACES) {
    const fresh = await openTimelineClient(
      run.harness,
      run.log.threadId,
      surface,
    );
    try {
      await expectClientMatchesFullBuild(run, fresh, "fresh client");
    } finally {
      fresh.close();
    }
  }
}

async function runSeed({
  extensionStates,
  seed,
  shape,
}: SeedRun): Promise<void> {
  await withTestHarness(SMALL_WINDOWS, async (harness) => {
    const rng = createRng(seed);
    const provider = extensionStates ? registerGuardProvider(harness) : null;
    const log = createThreadLog({
      harness,
      providerId: provider?.providerId ?? "codex",
      rng,
      shape,
    });
    const run: Run = { harness, log, operations: [], rng, seed };
    const declareStateKinds = async (target: GuardProvider) => {
      const kinds = pickStateKinds(rng);
      target.declareStateKinds(kinds);
      run.operations.push(`declare state kinds [${kinds.join(", ")}]`);
      await checkReads(run, clients);
    };
    for (let step = 0; step < 40; step += 1) log.step();
    const openClients = () =>
      Promise.all(
        SURFACES.map((surface) =>
          openTimelineClient(harness, log.threadId, surface),
        ),
      );
    let clients = await openClients();
    const reloadClients = async () => {
      for (const client of clients) client.close();
      clients = await openClients();
    };
    try {
      for (let index = 0; index < OPERATIONS_PER_SEED; index += 1) {
        const roll = rng();
        const client = pick(rng, clients);
        if (roll < 0.4) {
          const steps = 1 + Math.floor(rng() * 4);
          for (let step = 0; step < steps; step += 1) log.step();
          run.operations.push(`append ${steps}`);
          for (const each of clients) {
            const delivery = rng();
            if (delivery < 0.6) await each.deliverPushes();
            else if (delivery < 0.8) await each.refetch();
          }
        } else if (roll < 0.55) {
          await client.loadOlder();
          run.operations.push(`older ${client.surface.segmentLimit}`);
        } else if (roll < 0.62) {
          await client.refetch();
          run.operations.push(`refetch ${client.surface.segmentLimit}`);
        } else if (roll < 0.67) {
          if (log.editLatestMessage()) {
            run.operations.push("edit");
            await reloadClients();
          }
        } else if (roll < 0.72) {
          run.operations.push(`prune ${log.prune()}`);
        } else if (roll < 0.75 && provider !== null) {
          await declareStateKinds(provider);
        } else if (roll < 0.75) {
          log.rename();
          run.operations.push("rename");
        } else if (roll < 0.79) {
          if (log.advanceClockPastRetention()) {
            run.operations.push("clock past retention");
            await reloadClients();
            await checkReads(run, clients);
          }
        } else if (roll < 0.81 && provider !== null) {
          await declareStateKinds(provider);
        } else if (roll < 0.81) {
          const swept = log.sweepExpiredOutputs();
          run.operations.push(`sweep ${swept}`);
          if (swept > 0) await reloadClients();
        } else if (roll < 0.9) {
          await client.deliverPushes();
          run.operations.push(`push ${client.surface.segmentLimit}`);
        } else {
          run.operations.push("check");
          await checkReads(run, clients);
        }
      }
      log.finishOpenWork();
      run.operations.push("finish");
      await checkReads(run, clients);
    } finally {
      for (const client of clients) client.close();
    }
  });
}

describe("timeline read path equivalence", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(SEED_RUNS)(
    "seed $seed: paged reads match one uncached full build",
    async (run) => {
      await runSeed(run);
    },
    60_000,
  );
});
