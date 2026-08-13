import { describe, expect, it, vi } from "vitest";
import { runTier0, type Tier0CheckContext } from "./tier0.js";

const context: Tier0CheckContext = {
  projectId: "project-a",
  pvId: "version-a",
  firmwareDigest: "a".repeat(64),
  hostId: "host-a",
  target: null,
  requirementId: "REQ-A",
};

describe("Tier 0 execution", () => {
  it.each(["pass", "fail"] as const)("preserves an explicitly mapped %s", async (outcome) => {
    const evidence = await runTier0(
      [
        {
          id: "analyzer-a",
          run: async () => ({
            checkId: "check-a",
            requirementId: "REQ-A",
            outcome,
            summary: "explicit",
          }),
        },
      ],
      context,
      new AbortController().signal,
    );
    expect(evidence.results).toEqual([
      {
        checkId: "check-a",
        requirementId: "REQ-A",
        outcome,
        evidenceSummary: "explicit",
      },
    ]);
  });

  it("keeps a check with no requirement mapping visibly unmapped", async () => {
    const evidence = await runTier0(
      [
        {
          id: "unknown-check",
          run: async () => ({ checkId: "unknown-check", outcome: "fail", summary: null }),
        },
      ],
      { ...context, requirementId: null },
      new AbortController().signal,
    );
    expect(evidence.results[0]).toMatchObject({
      requirementId: "unmapped:unknown-check",
      checkId: "unknown-check",
      outcome: "fail",
    });
  });

  it("downgrades a partial analyzer pass to evidence error", async () => {
    const evidence = await runTier0(
      [
        {
          id: "partial",
          run: async () => ({
            checkId: "partial",
            outcome: "pass",
            summary: "Only one partition",
            partial: true,
          }),
        },
      ],
      context,
      new AbortController().signal,
    );
    expect(evidence.results[0]).toMatchObject({ outcome: "error" });
    expect(evidence.results[0]?.evidenceSummary).toContain("partial evidence");
  });

  it("converts an analyzer exception to error evidence rather than pass", async () => {
    const run = vi.fn(async () => {
      throw new Error("binary parser crashed");
    });
    const evidence = await runTier0(
      [{ id: "binary", run }],
      context,
      new AbortController().signal,
    );
    expect(evidence.results[0]).toEqual({
      requirementId: "REQ-A",
      checkId: "binary",
      outcome: "error",
      evidenceSummary: "binary parser crashed",
    });
  });
});

