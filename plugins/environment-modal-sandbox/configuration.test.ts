import { describe, expect, it } from "vitest";
import { resolveSettings, type RawSettings } from "./configuration.js";

function settings(overrides: Partial<RawSettings> = {}): RawSettings {
  return {
    tokenId: "token-id",
    tokenSecret: "token-secret",
    appName: "bb-sandboxes",
    image: "node:22-bookworm",
    timeoutMinutes: "60",
    idleMinutes: "15",
    cpu: "",
    memoryMiB: "",
    ...overrides,
  };
}

describe("sandbox environment", () => {
  it("leaves runtime environment contributions out of image and sandbox settings", () => {
    expect(resolveSettings(settings())).toMatchObject({
      ok: true,
      settings: { environmentVariables: {} },
    });
  });
});

describe("idle hibernation", () => {
  it("defaults to a concrete delay and allows disabling it", () => {
    expect(resolveSettings(settings())).toMatchObject({
      ok: true,
      settings: { idleMs: 15 * 60_000 },
    });
    expect(resolveSettings(settings({ idleMinutes: "0" }))).toMatchObject({
      ok: true,
      settings: { idleMs: null },
    });
  });

  it("rejects a delay outside the supported range", () => {
    expect(resolveSettings(settings({ idleMinutes: "1.5" }))).toEqual({
      ok: false,
      message:
        "Modal sandbox idleMinutes must be a whole number between 0 and 1440, not 1.5.",
    });
  });
});
