import { describe, expect, it } from "vitest";

import { loadGuide, loadedGuide } from "./guides";

describe("loadGuide", () => {
  it("loads one guide by slug and keeps it for rendering", async () => {
    const guide = await loadGuide("orchestrate-coding-agents");
    expect(guide?.slug).toBe("orchestrate-coding-agents");
    expect(loadedGuide("orchestrate-coding-agents")).toBe(guide);
  });

  it("returns null for an unknown slug", async () => {
    await expect(loadGuide("missing-guide")).resolves.toBeNull();
    expect(loadedGuide("missing-guide")).toBeUndefined();
  });
});
