import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPOSER_SELECTION_SETTLE_TIMEOUT_MS,
  createCommittedStateObserver,
  readExecutionSelection,
  resolveComposerSelectionDeadline,
  setComposerSelectionSettleTimeoutForTest,
} from "./composer-selection-settle";

interface State {
  version: number;
  isSettled: boolean;
}

describe("createCommittedStateObserver", () => {
  afterEach(() => {
    vi.useRealTimers();
    setComposerSelectionSettleTimeoutForTest(null);
  });

  it("resolves waiters as soon as a published state satisfies them", async () => {
    const observer = createCommittedStateObserver<State>();
    const settled = observer.waitUntil(
      (state) => state.version >= 2 && state.isSettled,
      Date.now() + 10_000,
    );
    observer.publish({ version: 1, isSettled: true });
    observer.publish({ version: 2, isSettled: false });
    observer.publish({ version: 2, isSettled: true });
    await expect(settled).resolves.toEqual({ version: 2, isSettled: true });
    await expect(
      observer.waitUntil((state) => state.version >= 1, Date.now() + 10_000),
    ).resolves.toEqual({ version: 2, isSettled: true });
  });

  it("resolves with the latest state once the deadline passes", async () => {
    vi.useFakeTimers();
    const observer = createCommittedStateObserver<State>();
    observer.publish({ version: 1, isSettled: false });
    const timedOut = observer.waitUntil(
      (state) => state.isSettled,
      Date.now() + 500,
    );
    observer.publish({ version: 2, isSettled: false });
    vi.advanceTimersByTime(499);
    let resolved = false;
    void timedOut.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(timedOut).resolves.toEqual({ version: 2, isSettled: false });
    observer.publish({ version: 3, isSettled: true });
    expect(resolved).toBe(true);
  });

  it("rejects a deadline that passes before any state was published", async () => {
    vi.useFakeTimers();
    const observer = createCommittedStateObserver<State>();
    const neverPublished = observer.waitUntil(() => true, Date.now() + 10);
    vi.advanceTimersByTime(10);
    await expect(neverPublished).rejects.toThrow(/not ready/);
  });

  it("uses the test override for the settle deadline", () => {
    expect(resolveComposerSelectionDeadline(1_000)).toBe(
      1_000 + COMPOSER_SELECTION_SETTLE_TIMEOUT_MS,
    );
    setComposerSelectionSettleTimeoutForTest(25);
    expect(resolveComposerSelectionDeadline(1_000)).toBe(1_025);
  });
});

describe("readExecutionSelection", () => {
  it("omits empty selections and unsupported tiers", () => {
    expect(
      readExecutionSelection({
        selectedProviderId: "",
        selectedThreadModel: "",
        reasoningLevel: "medium",
        serviceTier: "fast",
        supportsServiceTier: false,
        permissionMode: "auto",
      }),
    ).toEqual({ reasoningLevel: "medium", permissionMode: "auto" });
    expect(
      readExecutionSelection({
        selectedProviderId: "codex",
        selectedThreadModel: "gpt-5",
        reasoningLevel: "high",
        serviceTier: "fast",
        supportsServiceTier: true,
        permissionMode: "full",
      }),
    ).toEqual({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "full",
    });
  });
});
