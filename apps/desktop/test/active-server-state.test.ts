import { describe, expect, it } from "vitest";
import { createActiveServerState } from "../src/active-server-state.js";

describe("active server state", () => {
  it("defaults windows to the most recent server id", () => {
    const state = createActiveServerState({ defaultServerId: "builtin-local" });

    expect(state.getActiveServerId(1)).toBe("builtin-local");
    expect(state.getMostRecentServerId()).toBe("builtin-local");
  });

  it("tracks per-window active servers and most-recent inheritance", () => {
    const state = createActiveServerState({ defaultServerId: "builtin-local" });

    state.setActiveServerId(1, "remote-a");
    expect(state.getActiveServerId(1)).toBe("remote-a");
    expect(state.getMostRecentServerId()).toBe("remote-a");
    // Unmapped windows inherit the most recently activated server.
    expect(state.getActiveServerId(2)).toBe("remote-a");

    state.setActiveServerId(2, "remote-b");
    expect(state.getActiveServerId(1)).toBe("remote-a");
    expect(state.getActiveServerId(2)).toBe("remote-b");
    expect(state.getMostRecentServerId()).toBe("remote-b");
    expect(state.getActiveServerId(3)).toBe("remote-b");
  });

  it("clears destroyed windows without changing most-recent", () => {
    const state = createActiveServerState({ defaultServerId: "builtin-local" });
    state.setActiveServerId(1, "remote-a");
    state.setActiveServerId(2, "remote-b");
    state.clearWindow(2);

    expect(state.getMostRecentServerId()).toBe("remote-b");
    expect(state.getActiveServerId(2)).toBe("remote-b");
    expect(state.getActiveServerId(1)).toBe("remote-a");
  });
});
