import { describe, expect, it } from "vitest";

import { findingStableKey, parseFindingStableKey } from "../../../lib/sync/registry.js";
import { foldFindingComponent, foldFindingGroup } from "./fold.js";

describe("finding identity comparison folding", () => {
  it("agrees byte-for-byte with the frozen Unicode key vectors", () => {
    const encoded = findingStableKey({
      cve: "CVE-2026-37",
      name: "  CAFÉ-部件  ",
      group: "  GRÖUP  ",
      version: "1.0.0",
    }, "name-group-version");
    const parsed = parseFindingStableKey(encoded);
    expect(parsed.component).toEqual({
      name: foldFindingComponent("  CAFÉ-部件  "),
      group: foldFindingComponent("  GRÖUP  "),
      version: "1.0.0",
    });
    expect(findingStableKey({
      cve: "CVE-2026-37",
      name: "café-部件",
      group: "gröup",
      version: "1.0.0",
    }, "name-group-version")).toBe(encoded);
  });

  it("treats NULL, empty, and whitespace-only cache groups consistently", () => {
    expect(foldFindingGroup(null)).toBeNull();
    expect(foldFindingGroup("")).toBeNull();
    expect(foldFindingGroup("   ")).toBeNull();
  });
});
