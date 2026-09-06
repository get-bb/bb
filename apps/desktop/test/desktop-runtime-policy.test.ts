import { describe, expect, it } from "vitest";
import type { ForeignRuntimeDetails } from "../src/foreign-runtime.js";
import {
  shouldAutoAttachToForeignRuntime,
  shouldStopRuntimeOnQuit,
} from "../src/desktop-runtime-policy.js";

function detailsWithVersion(version: string): ForeignRuntimeDetails {
  return {
    dataDir: "C:\\Users\\example\\.bb",
    entryPath: "C:\\bb\\bb-app.js",
    pid: 4_242,
    startedAt: "2026-09-06T11:30:00.000Z",
    surface: "terminal",
    version,
  };
}

describe("shouldAutoAttachToForeignRuntime", () => {
  it("attaches without prompting when the recorded version matches the app", () => {
    expect(
      shouldAutoAttachToForeignRuntime({
        desktopVersion: "0.42.1",
        details: detailsWithVersion("0.42.1"),
      }),
    ).toBe(true);
  });

  it("prompts when the running copy is a different version", () => {
    expect(
      shouldAutoAttachToForeignRuntime({
        desktopVersion: "0.42.1",
        details: detailsWithVersion("0.41.0"),
      }),
    ).toBe(false);
  });

  it("prompts when the running copy cannot be identified", () => {
    expect(
      shouldAutoAttachToForeignRuntime({
        desktopVersion: "0.42.1",
        details: null,
      }),
    ).toBe(false);
  });

  it("prompts when the app version is unknown", () => {
    expect(
      shouldAutoAttachToForeignRuntime({
        desktopVersion: null,
        details: detailsWithVersion("0.42.1"),
      }),
    ).toBe(false);
  });
});

describe("shouldStopRuntimeOnQuit", () => {
  it("stops a runtime this app started", () => {
    expect(shouldStopRuntimeOnQuit({ ownership: "spawned" })).toBe(true);
  });

  it("never stops a runtime this app only attached to", () => {
    expect(shouldStopRuntimeOnQuit({ ownership: "attached" })).toBe(false);
  });
});
