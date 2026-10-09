import { describe, expect, it } from "vitest";
import {
  messageActionScore,
  recordMessageActionUsage,
  type MessageActionUsage,
} from "./message-action-usage";

const NOW = Date.UTC(2026, 9, 5, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("message action usage", () => {
  it("halves an action's score every two weeks without use", () => {
    const usage = recordMessageActionUsage({}, "fork", NOW - 14 * DAY_MS);

    expect(messageActionScore(usage, "fork", NOW)).toBeCloseTo(0.5);
    expect(messageActionScore(usage, "copy", NOW)).toBe(0);
  });

  it("adds each use to the decayed score", () => {
    const first = recordMessageActionUsage({}, "fork", NOW - 14 * DAY_MS);
    const second = recordMessageActionUsage(first, "fork", NOW);

    expect(second.fork).toEqual({ score: 1.5, usedAt: NOW });
  });

  it("keeps only the highest-scoring actions once the record is full", () => {
    let usage: MessageActionUsage = {};
    for (let index = 0; index < 64; index += 1) {
      usage = recordMessageActionUsage(usage, `plugin:${index}`, NOW);
      usage = recordMessageActionUsage(usage, `plugin:${index}`, NOW);
    }
    usage = recordMessageActionUsage(usage, "fork", NOW);

    expect(Object.keys(usage)).toHaveLength(64);
    expect(usage.fork).toBeUndefined();
  });
});
