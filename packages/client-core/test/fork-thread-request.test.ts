import type { Thread } from "@bb/domain";
import { makeThread as makeThreadFixture } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { isThreadForkable } from "../src/prompt/fork-thread-request.js";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    createdAt: 1,
    environmentId: "env_source",
    id: "thr_source",
    lastReadAt: null,
    latestAttentionAt: 1,
    title: "Investigate flaky test",
    titleFallback: null,
    updatedAt: 1,
    ...overrides,
  });
}

describe("isThreadForkable", () => {
  it("rejects an archived source and permits it after unarchiving", () => {
    const source = makeThread({ archivedAt: 123 });

    expect(isThreadForkable(source, true)).toBe(false);
    expect(isThreadForkable({ ...source, archivedAt: null }, true)).toBe(true);
  });

  it("is true only with an environment id and a fork-capable provider", () => {
    expect(
      isThreadForkable(makeThread({ environmentId: "env_source" }), true),
    ).toBe(true);
    expect(isThreadForkable(makeThread({ environmentId: null }), true)).toBe(
      false,
    );
    expect(
      isThreadForkable(makeThread({ providerId: "not-a-provider" }), false),
    ).toBe(false);
    expect(isThreadForkable(null, true)).toBe(false);
  });
});
