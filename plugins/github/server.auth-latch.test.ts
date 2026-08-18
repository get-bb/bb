// Repro for get-bb/bb#1758: the github plugin probes `gh auth status` once at
// load, latches needs-configuration on any failure, and never re-probes.
//
// A fake `gh` on PATH fails (like a network blip / locked keychain / dead
// proxy) while the plugin loads, then starts succeeding. The plugin should
// notice that gh works again; on main it never does.
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

let binDir: string;
let offlineFlag: string; // exists → `gh auth status` fails like a network outage
let noTokenFlag: string; // exists → gh has no credentials at all
let callLog: string;
const originalPath = process.env.PATH;

function ghCalls(): string[] {
  if (!existsSync(callLog)) return [];
  return readFileSync(callLog, "utf8")
    .trim()
    .split("\n")
    .filter((line: string) => line.length > 0);
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "bb-1758-gh-"));
  offlineFlag = join(binDir, "gh-offline");
  noTokenFlag = join(binDir, "gh-no-token");
  callLog = join(binDir, "gh-calls.log");
  // Mimics real `gh` (2.96) closely enough:
  //  --version     always works, so the plugin's resolveGh() finds it
  //  auth token    local-only, no network: succeeds unless no credentials
  //  auth status   network probe: fails with gh's verbatim "token is invalid"
  //                wording while offline (that IS what gh prints when it
  //                cannot reach api.github.com), or "You are not logged into
  //                any GitHub hosts" when there are no credentials.
  writeFileSync(
    join(binDir, "gh"),
    `#!/usr/bin/env bash
echo "$*" >> "${callLog}"
case "$1 $2" in
  "--version ") echo "gh version 2.96.0 (fake)"; exit 0;;
  "auth token")
    if [ -e "${noTokenFlag}" ]; then echo "no oauth token found for github.com" >&2; exit 1; fi
    echo "gho_fake_token_is_configured_locally"; exit 0;;
  "auth status")
    if [ -e "${noTokenFlag}" ]; then
      echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1
    fi
    if [ -e "${offlineFlag}" ]; then
      echo "github.com" >&2
      echo "  X Failed to log in to github.com account someone (keyring)" >&2
      echo "  - The token in keyring is invalid." >&2
      exit 1
    fi
    echo "github.com"; echo "  ✓ Logged in to github.com account someone (keyring)"; exit 0;;
  *) echo "[]"; exit 0;;
esac
`,
  );
  chmodSync(join(binDir, "gh"), 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(binDir, { recursive: true, force: true });
});

async function loadWithSyncServiceOnce() {
  const { bb, harness } = createFakePluginHost({ pluginId: "github" });
  await plugin(bb);
  // Run the sync service the way the host does at activation. On main its
  // first syncAll() throws NeedsConfigurationError and it stops for good; a
  // fixed plugin keeps looping, so abort it after its first pass.
  const { controller, done } = harness.runService("sync");
  await new Promise((resolve) => setTimeout(resolve, 150));
  controller.abort();
  await done;
  return { bb, harness };
}

describe("github plugin gh auth probe (#1758)", () => {
  it("re-probes gh after a transient auth-status failure instead of latching", async () => {
    // 1. gh is "offline" while bb starts (credentials exist, API unreachable).
    writeFileSync(offlineFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    const before = (await harness.callRpc("status")) as { ghOk: boolean };
    expect(before.ghOk).toBe(false); // probe failed at load, as expected
    const callsWhileOffline = ghCalls().length;

    // 2. gh recovers (network back / keychain unlocked). Nothing else changes.
    rmSync(offlineFlag);

    // 3. The plugin is asked for its status (panel banner / `bb github`).
    //    A plugin that re-probes on demand or on its interval reports ghOk.
    //    On main NOTHING re-runs `gh auth status`: ghOk stays false with the
    //    stale error, and not a single further gh call is made.
    const after = (await harness.callRpc("status")) as {
      ghOk: boolean;
      ghError: string | null;
    };
    expect(ghCalls().length).toBeGreaterThan(callsWhileOffline); // FAILS on main: no re-probe
    expect(after.ghOk).toBe(true); // FAILS on main: latched
  });

  it('does not report needs-configuration ("run gh auth login") for a transient probe failure', async () => {
    writeFileSync(offlineFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    // FAILS on main: both the load-time probe and the sync service latch
    // needs-configuration with the `gh auth login` remedy, although gh holds
    // valid credentials and only the network probe failed.
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("still reports needs-configuration when gh has no credentials at all", async () => {
    writeFileSync(noTokenFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
    expect(harness.needsConfigurationMessages[0]).toContain("gh auth login");
  });

  it("control: with gh working from the start the plugin never reports needs-configuration", async () => {
    const { harness } = await loadWithSyncServiceOnce();
    expect(harness.needsConfigurationMessages).toEqual([]);
    const status = (await harness.callRpc("status")) as { ghOk: boolean };
    expect(status.ghOk).toBe(true);
  });
});
