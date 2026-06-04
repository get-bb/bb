import { describe, expect, it } from "vitest";
import {
  providerTurnWatchdogActivityEventTypeValues,
  providerTurnWatchdogThreadScopedActivityEventTypeValues,
  threadOnlyThreadEventTypes,
} from "../src/index.js";

describe("provider turn watchdog activity event types", () => {
  it("derives the thread-scoped activity list from the scope policy", () => {
    const threadOnlyTypes = new Set<string>(threadOnlyThreadEventTypes);
    expect(providerTurnWatchdogThreadScopedActivityEventTypeValues).toEqual(
      providerTurnWatchdogActivityEventTypeValues.filter((eventType) =>
        threadOnlyTypes.has(eventType),
      ),
    );
  });

  it("restricts thread-scoped watchdog activity to the background task family", () => {
    // Canary, not an implementation detail: the thread-scoped list feeds the
    // SQL NULL-turn anchor arm in @bb/db. If this fails, either an activity
    // event type's scope policy changed or a new thread-scoped activity type
    // was added — both change which events hold the watchdog off, so confirm
    // the watchdog query semantics deliberately before updating it.
    expect(providerTurnWatchdogThreadScopedActivityEventTypeValues).toEqual([
      "item/backgroundTask/progress",
      "item/backgroundTask/completed",
    ]);
  });
});
