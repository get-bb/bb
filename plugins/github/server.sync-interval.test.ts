import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { syncIntervalMinutesForRepoCount } from "./server";

let binDir: string;
const originalPath = process.env.PATH;
const originalSetTimeout = globalThis.setTimeout;

let parkDelays: number[] = [];

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "bb-gh-interval-"));
  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env bash
case "$1 $2" in
  "--version ") echo "gh version 2.96.0 (fake)"; exit 0;;
  "auth status") echo "github.com"; echo "  ✓ Logged in to github.com account someone (keyring)"; exit 0;;
  *) echo "[]"; exit 0;;
esac
`,
  );
  chmodSync(join(binDir, "gh"), 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  parkDelays = [];
  vi.stubGlobal("setTimeout", ((
    handler: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (typeof delay === "number" && delay >= 60_000) {
      parkDelays.push(delay);
      return originalSetTimeout(handler, 1);
    }
    return originalSetTimeout(handler, delay, ...args);
  }) as typeof globalThis.setTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.PATH = originalPath;
  rmSync(binDir, { recursive: true, force: true });
});

async function collectParkDelays(settings?: Record<string, string>) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "github",
    settings,
  });
  await plugin(bb);
  const { controller, done } = harness.runService("sync");
  await vi.waitFor(() => expect(parkDelays.length).toBeGreaterThan(0), {
    timeout: 8_000,
  });
  return { harness, controller, done };
}

describe("syncIntervalMinutesForRepoCount", () => {
  it("stays at 5 minutes for an empty or tiny catalog", () => {
    expect(syncIntervalMinutesForRepoCount(0)).toBe(5);
    expect(syncIntervalMinutesForRepoCount(1)).toBe(5);
    expect(syncIntervalMinutesForRepoCount(8)).toBe(5);
  });

  it("grows with repo count so list-call volume stays near 400/hour", () => {
    expect(syncIntervalMinutesForRepoCount(34)).toBe(21);
    expect(syncIntervalMinutesForRepoCount(50)).toBe(30);
    expect(syncIntervalMinutesForRepoCount(200)).toBe(60);
  });

  it("clamps nonsense counts", () => {
    expect(syncIntervalMinutesForRepoCount(-3)).toBe(5);
    expect(syncIntervalMinutesForRepoCount(Number.NaN)).toBe(5);
  });
});

describe("github sync interval auto-scale", () => {
  it("parks 5 minutes when no repos are tracked", async () => {
    const { controller, done } = await collectParkDelays();
    controller.abort();
    await done;
    expect(parkDelays[0]).toBe(5 * 60_000);
  });

  it("parks longer when many extraRepos are tracked", async () => {
    const repos = Array.from(
      { length: 34 },
      (_, i) => `owner/repo-${i}`,
    ).join(", ");
    const { controller, done } = await collectParkDelays({
      extraRepos: repos,
    });
    controller.abort();
    await done;
    expect(parkDelays[0]).toBe(21 * 60_000);
  });

  it("does not expose a manual interval setting", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "github" });
    await plugin(bb);
    expect(
      harness.registrations.settingsDescriptors.syncIntervalMinutes,
    ).toBeUndefined();
  });
});
