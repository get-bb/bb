import { describe, expect, it } from "vitest";
import {
  BomRouteError,
  decodeComponentRouteKey,
  encodeComponentRouteKey,
  parseBomSubPath,
} from "./routes.js";

describe("BOM routes", () => {
  it.each([
    "pkg:npm/@scope/组件@1.2.3?arch=arm64",
    "SBOM-COMPONENT\u001fpkg:generic/naïve@β",
  ])("round-trips Unicode and purl component keys", (key) => {
    const encoded = encodeComponentRouteKey(key);
    expect(decodeComponentRouteKey(encoded)).toBe(key);
    expect(parseBomSubPath(`software/${encoded}`)).toEqual({
      tab: "software",
      componentKey: key,
    });
  });

  it("returns null for invalid base64url", () => {
    expect(parseBomSubPath("software/not+base64")).toBeNull();
    expect(parseBomSubPath("software/8J-A")).toBeNull();
  });

  it("rejects overlong route segments as BAD_ROUTE", () => {
    let error: unknown;
    try {
      decodeComponentRouteKey("a".repeat(769));
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(BomRouteError);
    expect((error as BomRouteError).code).toBe("BAD_ROUTE");
    expect(parseBomSubPath(`software/${"a".repeat(769)}`)).toBeNull();
  });

  it("parses shipped view and reserved hardware routes", () => {
    expect(parseBomSubPath("software/view/Copyleft")).toEqual({
      tab: "software",
      savedView: "Copyleft",
    });
    expect(parseBomSubPath("hardware/review")).toEqual({
      tab: "hardware",
      screen: "review",
    });
  });
});
