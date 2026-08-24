import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNodeEnvironment } from "../src/lib/script-config.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("script-config", () => {
  it("maps NODE_ENV values to script modes", () => {
    expect(resolveNodeEnvironment("dev")).toBe("development");
    expect(resolveNodeEnvironment("prod")).toBe("production");
  });
});
