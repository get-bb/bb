import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createThreadDerivedCache,
  type ThreadDerivedCacheOptions,
} from "../../../src/services/threads/thread-derived-cache.js";

function cache(options: Partial<ThreadDerivedCacheOptions<string>> = {}) {
  return createThreadDerivedCache<string>({
    maxEntries: 16,
    bytes: { maxBytes: 1_000, maxEntryBytes: 1_000, measure: (v) => v.length },
    ...options,
  });
}

function read(
  slot: string,
  revision: string,
  value: string,
  options: { expiresAt?: number | null; threadId?: string } = {},
) {
  const build = vi.fn((_previous: string | undefined) => ({
    expiresAt: options.expiresAt ?? null,
    value,
  }));
  return { build, revision, slot, threadId: options.threadId ?? "thr_x" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createThreadDerivedCache", () => {
  it("serves a slot until its revision changes, then rebuilds from the previous value", () => {
    const subject = cache();
    const first = read("slot", "r1", "a");
    subject.getOrBuild(first);
    subject.getOrBuild(first);
    const next = read("slot", "r2", "b");

    expect(subject.getOrBuild(next)).toBe("b");
    expect(first.build).toHaveBeenCalledTimes(1);
    expect(next.build).toHaveBeenCalledWith("a");
    expect(subject.size).toBe(1);
  });

  it("rebuilds an entry once the clock reaches its expiry", () => {
    const subject = cache();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const entry = read("slot", "r1", "a", { expiresAt: 2_000 });
    subject.getOrBuild(entry);
    now.mockReturnValue(1_999);
    subject.getOrBuild(entry);
    now.mockReturnValue(2_000);
    subject.getOrBuild(entry);

    expect(entry.build).toHaveBeenCalledTimes(2);
  });

  it("keeps an idle thread while another thread's slot churns through revisions", () => {
    const subject = cache({ maxEntries: 2 });
    const idle = read("idle", "r1", "idle", { threadId: "thr_idle" });
    subject.getOrBuild(idle);
    for (let revision = 0; revision < 20; revision += 1) {
      subject.getOrBuild(
        read("streaming", `r${revision}`, "s", { threadId: "thr_streaming" }),
      );
    }
    subject.getOrBuild(idle);

    expect(idle.build).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used slot beyond maxEntries or maxBytes", () => {
    for (const options of [
      { maxEntries: 2 },
      {
        bytes: {
          maxBytes: 25,
          maxEntryBytes: 25,
          measure: (v: string) => v.length,
        },
      },
    ]) {
      const subject = cache(options);
      const a = read("a", "r", "x".repeat(10));
      const b = read("b", "r", "x".repeat(10));
      subject.getOrBuild(a);
      subject.getOrBuild(b);
      subject.getOrBuild(a);
      subject.getOrBuild(read("c", "r", "x".repeat(10)));
      subject.getOrBuild(a);
      subject.getOrBuild(b);

      expect(a.build).toHaveBeenCalledTimes(1);
      expect(b.build).toHaveBeenCalledTimes(2);
    }
  });

  it("drops a stale entry whose rebuild is too large to keep", () => {
    const subject = cache({
      bytes: { maxBytes: 100, maxEntryBytes: 5, measure: (v) => v.length },
    });
    subject.getOrBuild(read("slot", "r1", "a"));
    const large = read("slot", "r2", "x".repeat(6));
    subject.getOrBuild(large);
    subject.getOrBuild(large);

    expect(large.build).toHaveBeenCalledTimes(2);
    expect(subject.size).toBe(0);
  });

  it("counts no bytes without a byte budget", () => {
    const subject = cache({ bytes: null, maxEntries: 2 });
    const large = read("slot", "r", "x".repeat(10_000));
    subject.getOrBuild(large);
    subject.getOrBuild(large);

    expect(large.build).toHaveBeenCalledTimes(1);
  });

  it("invalidates only the given thread's slots", () => {
    const subject = cache();
    const x = read("x", "r", "x", { threadId: "thr_x" });
    const y = read("y", "r", "y", { threadId: "thr_y" });
    subject.getOrBuild(x);
    subject.getOrBuild(y);
    subject.invalidateThread("thr_x");
    subject.getOrBuild(x);
    subject.getOrBuild(y);

    expect(x.build).toHaveBeenCalledTimes(2);
    expect(y.build).toHaveBeenCalledTimes(1);
  });
});
