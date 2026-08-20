import { describe, expect, it } from "vitest";
import { parseAppSurface, parseRequestAppSurface } from "../src/app-surface.js";

describe("app surface parsing", () => {
  it("accepts mobile only as a request surface", () => {
    // `mobile` is a client declaration (x-bb-app-surface); a bb server can
    // never be configured as the mobile surface (BB_APP_SURFACE).
    expect(parseRequestAppSurface("mobile")).toBe("mobile");
    expect(parseRequestAppSurface(" web ")).toBe("web");
    expect(parseAppSurface("mobile")).toBeUndefined();
    expect(parseAppSurface("desktop")).toBe("desktop");
  });

  it("rejects unknown and empty values on both parsers", () => {
    expect(parseRequestAppSurface("tv")).toBeUndefined();
    expect(parseRequestAppSurface(null)).toBeUndefined();
    expect(parseAppSurface("")).toBeUndefined();
  });
});
