import { describe, expect, it } from "vitest";
import { threadScope } from "../src/thread-event-scope.js";
import type { ThreadEvent } from "../src/provider-event.js";
import {
  BB_THREAD_NAME_TAG,
  fromProviderExternalThreadName,
  normalizeProviderThreadNameEvent,
  tagThreadName,
  toProviderExternalThreadName,
} from "../src/thread-name-tags.js";

describe("thread name tags", () => {
  it("round-trips user-provided literal bb-prefixed titles", () => {
    const providerName = toProviderExternalThreadName("[bb] Literal");

    expect(providerName).toBe("[bb] [bb] Literal");
    expect(fromProviderExternalThreadName(providerName)).toBe("[bb] Literal");
  });

  it("normalizes provider title events by stripping one bb tag", () => {
    const event = {
      type: "thread/name/updated",
      threadId: "t1",
      providerThreadId: "p1",
      scope: threadScope(),
      threadName: tagThreadName({
        name: "[bb] Literal",
        tag: BB_THREAD_NAME_TAG,
      }),
    } satisfies ThreadEvent;

    expect(normalizeProviderThreadNameEvent(event)).toEqual({
      ...event,
      threadName: "[bb] Literal",
    });
  });

  it("returns non-name events unchanged", () => {
    const event = {
      type: "thread/started",
      threadId: "t1",
      scope: threadScope(),
    } satisfies ThreadEvent;

    expect(normalizeProviderThreadNameEvent(event)).toBe(event);
  });
});
