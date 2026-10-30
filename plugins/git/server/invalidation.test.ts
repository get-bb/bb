import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gitFilesTag,
  gitRefsTag,
  gitStatusTag,
  gitViewedTag,
} from "../contract.js";
import {
  createCoalescedInvalidator,
  tagsForEnvironmentChanges,
} from "./invalidation.js";

describe("tagsForEnvironmentChanges", () => {
  it("refreshes status and files on file changes and refs too on ref changes", () => {
    expect(tagsForEnvironmentChanges("env_1", ["work-status-changed"])).toEqual({
      tags: [gitStatusTag("env_1"), gitFilesTag("env_1")],
      clearCaches: true,
      refsChanged: false,
    });
    expect(
      tagsForEnvironmentChanges("env_1", ["git-refs-changed"]).tags,
    ).toContain(gitRefsTag("env_1"));
  });

  it("keeps cached git reads when only metadata or viewed marks change", () => {
    expect(
      tagsForEnvironmentChanges("env_1", ["metadata-changed"]).clearCaches,
    ).toBe(false);
    expect(tagsForEnvironmentChanges("env_1", ["diff-viewed-changed"])).toEqual({
      tags: [gitViewedTag("env_1")],
      clearCaches: false,
      refsChanged: false,
    });
  });
});

describe("createCoalescedInvalidator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes one union of tags for a burst of changes", () => {
    const publish = vi.fn();
    const invalidator = createCoalescedInvalidator(publish);
    invalidator.invalidate("env_1", ["a"]);
    vi.advanceTimersByTime(100);
    invalidator.invalidate("env_1", ["b"]);
    vi.advanceTimersByTime(249);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toEqual(["a", "b"]);
    invalidator.dispose();
  });

  it("flushes a continuous stream of changes within the maximum wait", () => {
    const publish = vi.fn();
    const invalidator = createCoalescedInvalidator(publish);
    for (let elapsed = 0; elapsed < 500; elapsed += 100) {
      invalidator.invalidate("env_1", ["a"]);
      vi.advanceTimersByTime(100);
    }
    expect(publish).toHaveBeenCalledTimes(1);
    invalidator.dispose();
  });

  it("spaces flushes for one environment at least a second apart", () => {
    const publish = vi.fn();
    const invalidator = createCoalescedInvalidator(publish);
    invalidator.invalidate("env_1", ["a"]);
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledTimes(1);
    invalidator.invalidate("env_1", ["b"]);
    vi.advanceTimersByTime(999);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual(["b"]);
    invalidator.dispose();
  });

  it("does not hold one environment's flush behind another's", () => {
    const publish = vi.fn();
    const invalidator = createCoalescedInvalidator(publish);
    invalidator.invalidate("env_1", ["a"]);
    vi.advanceTimersByTime(250);
    invalidator.invalidate("env_2", ["b"]);
    vi.advanceTimersByTime(250);
    expect(publish.mock.calls.map(([tags]) => tags)).toEqual([["a"], ["b"]]);
    invalidator.dispose();
  });

  it("drops a pending flush when the environment is forgotten", () => {
    const publish = vi.fn();
    const invalidator = createCoalescedInvalidator(publish);
    invalidator.invalidate("env_1", ["a"]);
    invalidator.forget("env_1");
    vi.advanceTimersByTime(1_000);
    expect(publish).not.toHaveBeenCalled();
    invalidator.dispose();
  });
});
