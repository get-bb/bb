import { CORE_ITEM_KINDS } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { MOBILE_ITEM_KIND_MAP } from "./item-kind-map";
import { TIMELINE_ROW_KINDS } from "./rows";

describe("mobile item kind map (guardrail G4)", () => {
  it("decides every core item kind plus the extension fallback, nothing else", () => {
    expect(Object.keys(MOBILE_ITEM_KIND_MAP).sort()).toEqual(
      [...CORE_ITEM_KINDS, "extension"].sort(),
    );
  });

  it("only maps onto row kinds the renderer registry knows", () => {
    for (const [itemKind, decision] of Object.entries(MOBILE_ITEM_KIND_MAP)) {
      if ("row" in decision) {
        expect(
          TIMELINE_ROW_KINDS.includes(decision.row),
          `${itemKind} maps to unknown row kind ${decision.row}`,
        ).toBe(true);
      }
    }
  });

  it("names the owning workstream on every fallback", () => {
    for (const [itemKind, decision] of Object.entries(MOBILE_ITEM_KIND_MAP)) {
      if ("fallback" in decision) {
        expect(decision.fallback, itemKind).toMatch(/^WS\d/u);
      }
    }
  });
});
