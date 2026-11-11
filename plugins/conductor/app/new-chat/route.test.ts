import { describe, expect, it } from "vitest";
import { draftKeyFor, environmentIdFromSubPath } from "./route.js";

describe("new chat route", () => {
  it("reads the environment id from the first sub-path segment", () => {
    expect(environmentIdFromSubPath("env_3i254vqiac")).toBe("env_3i254vqiac");
    expect(environmentIdFromSubPath("env%3Aa/extra")).toBe("env:a");
  });

  it("rejects an empty or malformed sub-path", () => {
    expect(environmentIdFromSubPath("")).toBeNull();
    expect(environmentIdFromSubPath("%E0%A4%A")).toBeNull();
  });

  it("keys drafts per workspace", () => {
    expect(draftKeyFor("env_a")).not.toBe(draftKeyFor("env_b"));
  });
});
