import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_ACTIVE_CATALOG,
  DEFAULT_CLAUDE_CODE_MODEL,
} from "./model-catalog.js";

describe("Claude Code curated catalog", () => {
  // Moving aliases resolve per account, which reads as safer, but they are not
  // what this list is for: it is the always-offered base set, and it must carry
  // BB's real labels and reasoning ladders. Aliases belong in the daemon's
  // selected-only catalog, which exists to label an already-stored selection.
  it("names version-pinned models rather than moving aliases", () => {
    for (const entry of CLAUDE_CODE_ACTIVE_CATALOG) {
      expect(entry.model).toMatch(/^claude-/);
      expect(entry.id).toBe(entry.model);
    }
  });

  // Mythos was offered to every account for "Project Glasswing access" while
  // most accounts could not run it. Entitlement-gated models must reach the
  // picker through account-scoped discovery, never through this list.
  it("omits entitlement-gated models", () => {
    expect(
      CLAUDE_CODE_ACTIVE_CATALOG.some((entry) =>
        entry.model.includes("mythos"),
      ),
    ).toBe(false);
  });

  it("contains the product default model exactly once", () => {
    const defaults = CLAUDE_CODE_ACTIVE_CATALOG.filter(
      (entry) => entry.model === DEFAULT_CLAUDE_CODE_MODEL,
    );

    expect(defaults.map((entry) => entry.model)).toEqual([
      DEFAULT_CLAUDE_CODE_MODEL,
    ]);
  });

  it("advertises a default reasoning effort each model actually supports", () => {
    for (const entry of CLAUDE_CODE_ACTIVE_CATALOG) {
      expect(
        entry.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      ).toContain(entry.defaultReasoningEffort);
    }
  });
});
