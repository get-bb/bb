import type { Profiler } from "node:inspector";
import { describe, expect, it } from "vitest";
import { createStallSampleSummarizer } from "../src/stall-attribution.js";

function profileWithSamples(timeDeltas: number[]): Profiler.Profile {
  return {
    startTime: 1_000_000,
    endTime: 1_100_000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "heartbeat",
          scriptId: "1",
          url: "server.js",
          lineNumber: 1,
          columnNumber: 0,
        },
      },
      {
        id: 2,
        callFrame: {
          functionName: "(garbage collector)",
          scriptId: "0",
          url: "",
          lineNumber: -1,
          columnNumber: -1,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: "writeSync",
          scriptId: "2",
          url: "node:fs",
          lineNumber: 10,
          columnNumber: 0,
        },
      },
      {
        id: 4,
        children: [3],
        callFrame: {
          functionName: "appendPluginLogLine",
          scriptId: "1",
          url: "plugin-log.ts",
          lineNumber: 20,
          columnNumber: 0,
        },
      },
    ],
    samples: [1, 2, 3, 1],
    timeDeltas,
  };
}

describe("stall sample attribution", () => {
  it("clips to the measured window and preserves GC and native callers instead of adjacent heartbeat work", () => {
    const result = createStallSampleSummarizer(
      profileWithSamples([5_000, 5_000, 5_000, 5_000]),
    )({
      startedAt: 1007,
      endedAt: 1014,
    });
    expect(result).toMatchObject({
      stallAttribution: "sampled",
      sampledMs: 7,
      unobservedMs: 0,
      stacks: [
        {
          sampledMs: 4,
          frames: [
            { functionName: "writeSync" },
            {
              functionName: "appendPluginLogLine",
              url: "plugin-log.ts",
              lineNumber: 21,
            },
          ],
        },
        { sampledMs: 3, frames: [{ functionName: "(garbage collector)" }] },
      ],
    });
  });

  it("does not charge a long unsampled gap or missing profile coverage to a single stack", () => {
    const result = createStallSampleSummarizer(
      profileWithSamples([5_000, 80_000, 5_000, 5_000]),
    )({
      startedAt: 990,
      endedAt: 1100,
    });
    expect(result).toMatchObject({ sampledMs: 25, unobservedMs: 85 });
    expect(
      result.stacks.find(
        (stack) => stack.frames[0]?.functionName === "(garbage collector)",
      )?.sampledMs,
    ).toBe(10);
    expect(
      createStallSampleSummarizer({ ...profileWithSamples([]), samples: [] })({
        startedAt: 1000,
        endedAt: 1100,
      }),
    ).toMatchObject({
      stallAttribution: "unattributed",
      sampledMs: 0,
      unobservedMs: 100,
      stacks: [],
    });
  });
  it.each(["(idle)", "(program)", "(root)"])(
    "does not report %s as a sampled blocker",
    (functionName) => {
      const profile = profileWithSamples([5_000]);
      profile.samples = [1];
      profile.nodes[0]!.callFrame.functionName = functionName;
      expect(
        createStallSampleSummarizer(profile)({
          startedAt: 1000,
          endedAt: 1005,
        }),
      ).toMatchObject({ stallAttribution: "unattributed", stacks: [] });
    },
  );
});
