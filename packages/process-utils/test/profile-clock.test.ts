import { expect, it } from "vitest";
import { calibrateProfileClock } from "../src/profile-clock.js";

it.each([0, 172_800_000, -172_800_000])(
  "aligns a consistent clock with origin offset %i ms",
  (offsetMs) => {
    expect(
      calibrateProfileClock({
        startClock: { beforeMs: 1_000 + offsetMs, afterMs: 1_004 + offsetMs },
        endClock: { beforeMs: 2_002 + offsetMs, afterMs: 2_006 + offsetMs },
        profileStartTimeUs: 1_000_000,
        profileEndTimeUs: 2_000_000,
        maximumUncertaintyMs: 10,
      }),
    ).toEqual({
      status: "calibrated",
      minimumOffsetMs: offsetMs + 2,
      maximumOffsetMs: offsetMs + 4,
      offsetUs: (offsetMs + 3) * 1_000,
    });
  },
);

it.each([
  {
    endBeforeMs: 2_002,
    endAfterMs: 2_012,
    status: "calibrated",
    offsetUs: 7_000,
  },
  {
    endBeforeMs: 2_002,
    endAfterMs: 2_013,
    status: "uncertain",
    offsetUs: null,
  },
  { endBeforeMs: 2_020, endAfterMs: 2_021, status: "disjoint", offsetUs: null },
  { endBeforeMs: 1_980, endAfterMs: 1_981, status: "disjoint", offsetUs: null },
] as const)(
  "classifies offset bounds ending at $endBeforeMs..$endAfterMs as $status",
  ({ endBeforeMs, endAfterMs, status, offsetUs }) => {
    const result = calibrateProfileClock({
      startClock: { beforeMs: 1_000, afterMs: 1_013 },
      endClock: { beforeMs: endBeforeMs, afterMs: endAfterMs },
      profileStartTimeUs: 1_000_000,
      profileEndTimeUs: 2_000_000,
      maximumUncertaintyMs: 10,
    });
    expect(result).toMatchObject({ status, offsetUs });
  },
);
