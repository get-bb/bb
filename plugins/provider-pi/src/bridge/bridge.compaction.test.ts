import { afterEach, beforeEach, expect, it } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const THREAD_ID = "thr_compactnoop";

let harness: FakePiBridgeHarness;

beforeEach(async () => {
  harness = await startFakePiBridge({
    prefix: "bb-pi-compaction-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

it("reports a refused manual compaction as skipped, after the compaction_end delivery", async () => {
  await harness.request(2, "thread/start", {
    threadId: THREAD_ID,
    cwd: harness.workspaceDir,
    instructionMode: "append",
    options: FULL_PERMISSION_OPTIONS,
  });
  const response = await harness.request(3, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: THREAD_ID,
    clientRequestId: "creq_cmpctnpabc",
    input: [
      {
        type: "text",
        text: "/compact",
        mentions: [
          {
            start: 0,
            end: 8,
            resource: {
              kind: "command",
              trigger: "/",
              name: "compact",
              source: "command",
              origin: "builtin",
              label: "compact",
              argumentHint: null,
            },
          },
        ],
      },
    ],
    apply: { settings: [], sessionOptions: [], providerOptions: [] },
    options: FULL_PERMISSION_OPTIONS,
  });
  expect(response.result).toEqual({ admission: "accepted" });
  await harness.waitForTurnBoundary(THREAD_ID);
  await harness.request(4, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });

  const kinds = harness
    .deltasOf(THREAD_ID)
    .filter((d) => d.kind !== "contextWindow")
    .map((d) =>
      d.kind === "turn.boundary"
        ? `turn.boundary:${String(d.status)}`
        : d.kind === "item.close"
          ? `item.close:${String(d.status)}`
          : String(d.kind),
    );
  const warning = harness
    .deltasOf(THREAD_ID)
    .find((d) => d.kind === "provider.warning");
  expect(warning).toMatchObject({ category: "compaction-skipped" });
  expect(kinds.slice(kinds.indexOf("input.accepted"))).toEqual([
    "input.accepted",
    "turn.open",
    "turn.open",
    "item.open",
    "provider.warning",
    "item.close:completed",
    "turn.boundary:completed",
  ]);
}, 30_000);
