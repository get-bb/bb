import { describe, expect, it } from "vitest";
import {
  dashboardRefreshIntervalMs,
  visibleServerPanel,
} from "./dashboard-live-state.js";

describe("dashboard live state", () => {
  it("hides a stale setup panel as soon as pairing completes", () => {
    expect(visibleServerPanel(true, "setup")).toBe("none");
    expect(visibleServerPanel(false, "setup")).toBe("setup");
    expect(visibleServerPanel(true, "repair")).toBe("repair");
  });

  it("keeps refreshing paired servers after the fast pairing phase", () => {
    expect(
      dashboardRefreshIntervalMs(
        [{ connected: false, lastSeenAt: null }],
        null,
      ),
    ).toBe(3_000);
    expect(
      dashboardRefreshIntervalMs([{ connected: true, lastSeenAt: null }], null),
    ).toBe(3_000);
    expect(
      dashboardRefreshIntervalMs(
        [{ connected: true, lastSeenAt: Date.now() }],
        null,
      ),
    ).toBe(10_000);
  });
});
