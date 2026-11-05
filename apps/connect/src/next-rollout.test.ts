import { afterEach, describe, expect, it } from "vitest";
import {
  CLOSED_ROLLOUT,
  NEXT_ROLLOUT_CACHE_MS,
  NEXT_ROLLOUT_KEY,
  inNextRollout,
  parseNextRollout,
  readNextRollout,
  resetNextRolloutCache,
  rolloutBucket,
} from "./next-rollout.js";

function kv(values: Array<string | null | Error>) {
  const reads: string[] = [];
  return {
    reads,
    CONNECT_DB_FLAGS: {
      async get(key: string) {
        reads.push(key);
        const next = values.shift() ?? null;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

afterEach(() => resetNextRolloutCache());

describe("connect-next rollout flag", () => {
  it("parses percent and labels and refuses anything else", () => {
    expect(parseNextRollout('{"percent":25,"labels":["bee"]}')).toEqual({
      percent: 25,
      labels: new Set(["bee"]),
    });
    expect(parseNextRollout('{"percent":0}')).toEqual({
      percent: 0,
      labels: new Set(),
    });
    for (const raw of [
      null,
      "",
      "{",
      "[]",
      "null",
      '{"percent":101}',
      '{"percent":null}',
      '{"percent":10,"labels":[1]}',
      '{"percent":10,"labels":{}}',
    ]) {
      expect(parseNextRollout(raw)).toBeNull();
    }
  });

  it("caches the flag for a while and keeps the last value through a KV failure", async () => {
    const source = kv(['{"percent":40}', new Error("kv down"), "{}"]);
    const first = await readNextRollout(source, CLOSED_ROLLOUT, 1_000);
    expect(first.percent).toBe(40);
    expect(
      (await readNextRollout(source, CLOSED_ROLLOUT, 1_000 + 1)).percent,
    ).toBe(40);
    expect(source.reads).toEqual([NEXT_ROLLOUT_KEY]);
    const failed = await readNextRollout(
      source,
      CLOSED_ROLLOUT,
      1_000 + NEXT_ROLLOUT_CACHE_MS,
    );
    expect(failed.percent).toBe(40);
    const invalid = await readNextRollout(
      source,
      CLOSED_ROLLOUT,
      1_000 + 2 * NEXT_ROLLOUT_CACHE_MS,
    );
    expect(invalid).toBe(CLOSED_ROLLOUT);
  });

  it("uses the fallback without a KV binding or a value", async () => {
    expect(await readNextRollout({}, CLOSED_ROLLOUT)).toBe(CLOSED_ROLLOUT);
    expect(await readNextRollout(kv([null]), CLOSED_ROLLOUT)).toBe(
      CLOSED_ROLLOUT,
    );
  });

  it("puts ids in stable buckets spread over 0 to 100", async () => {
    expect(await rolloutBucket("srv-a")).toBe(await rolloutBucket("srv-a"));
    const buckets = await Promise.all(
      Array.from({ length: 400 }, (_, index) => rolloutBucket(`srv-${index}`)),
    );
    expect(buckets.every((bucket) => bucket >= 0 && bucket < 100)).toBe(true);
    const under25 = buckets.filter((bucket) => bucket < 25).length;
    expect(under25).toBeGreaterThan(60);
    expect(under25).toBeLessThan(140);
  });

  it("admits listed labels, grandfathered ids and the percent's share", async () => {
    const rollout = { percent: 0, labels: new Set(["bee"]) };
    expect(
      await inNextRollout(rollout, { label: "bee", id: "x", usedNext: false }),
    ).toBe(true);
    expect(
      await inNextRollout(rollout, { label: "wasp", id: "x", usedNext: true }),
    ).toBe(true);
    expect(
      await inNextRollout(rollout, { label: "wasp", id: "x", usedNext: false }),
    ).toBe(false);
    const all = { percent: 100, labels: new Set<string>() };
    expect(
      await inNextRollout(all, { label: "wasp", id: "x", usedNext: false }),
    ).toBe(true);
    const bucket = await rolloutBucket("srv-z");
    expect(
      await inNextRollout(
        { percent: bucket + 0.01, labels: new Set() },
        { label: "z", id: "srv-z", usedNext: false },
      ),
    ).toBe(true);
    expect(
      await inNextRollout(
        { percent: bucket, labels: new Set() },
        { label: "z", id: "srv-z", usedNext: false },
      ),
    ).toBe(false);
  });
});
