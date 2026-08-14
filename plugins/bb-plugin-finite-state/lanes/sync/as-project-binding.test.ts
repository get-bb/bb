import { describe, expect, it } from "vitest";
import type { AssuranceStudioProjectLinkCandidate } from "../../lib/remote/types.js";
import { assuranceStudioProjectCandidateState } from "./as-project-binding.js";

function candidate(id: string): AssuranceStudioProjectLinkCandidate {
  return {
    linkId: `link-${id}`,
    assuranceStudioProjectId: id,
    assuranceStudioProjectName: id,
    platformProjectId: "platform-project",
    platformProjectName: "Platform Project",
    platformProjectVersionId: "platform-version",
    platformProjectVersionName: "1.0",
    isPrimary: true,
    syncStatus: "synced",
    lastSyncedAt: "2026-08-14T00:00:00.000Z",
    versionStrategy: "latest",
  };
}

describe("Assurance Studio project candidate state", () => {
  it("preserves ambiguity even when every candidate claims primary status", () => {
    const fourWay = ["as-a", "as-b", "as-c", "as-d"].map(candidate);
    const twoWay = ["as-e", "as-f"].map(candidate);
    expect(assuranceStudioProjectCandidateState(fourWay)).toBe("ambiguous");
    expect(assuranceStudioProjectCandidateState(twoWay)).toBe("ambiguous");
    expect(fourWay.map((item) => item.assuranceStudioProjectId)).toEqual([
      "as-a",
      "as-b",
      "as-c",
      "as-d",
    ]);
  });

  it("distinguishes one explicit candidate from no linked candidates", () => {
    expect(assuranceStudioProjectCandidateState([candidate("as-only")])).toBe(
      "unambiguous",
    );
    expect(assuranceStudioProjectCandidateState([])).toBe("none");
  });
});
