// Repro for get-bb/bb#1758: the github plugin probes `gh auth status` once at
// load, latches needs-configuration on any failure, and never re-probes.
//
// A fake `gh` on PATH fails (like a network blip / locked keychain / dead
// proxy) while the plugin loads, then starts succeeding. The plugin should
// notice that gh works again.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

let binDir: string;
let offlineFlag: string; // exists → `gh auth status` fails like a network outage
let noTokenFlag: string; // exists → gh has no credentials at all
let badSecondaryFlag: string; // exists → an unscoped `gh auth status` fails
let apiDownFlag: string; // exists → issue/pr list calls fail
let slowStatusFlag: string; // exists → `gh auth status` takes 300 ms
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
  badSecondaryFlag = join(binDir, "gh-bad-secondary");
  apiDownFlag = join(binDir, "gh-api-down");
  slowStatusFlag = join(binDir, "gh-slow-status");
  callLog = join(binDir, "gh-calls.log");
  // Mimics real `gh` (2.96) closely enough:
  //  --version     always works, so the plugin's resolveGh() finds it
  //  auth token    local-only, no network: succeeds unless no credentials
  //  auth status   network probe: fails with gh's verbatim "token is invalid"
  //                wording while offline (that IS what gh prints when it
  //                cannot reach api.github.com), or "You are not logged into
  //                any GitHub hosts" when there are no credentials. Without
  //                --active it also fails when a secondary account is broken.
  //  issue/pr list fail while the api-down flag exists
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
    [ -e "${slowStatusFlag}" ] && sleep 0.3
    if [ -e "${noTokenFlag}" ]; then
      echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1
    fi
    if [ -e "${offlineFlag}" ]; then
      echo "github.com" >&2
      echo "  X Failed to log in to github.com account someone (keyring)" >&2
      echo "  - The token in keyring is invalid." >&2
      exit 1
    fi
    if [ -e "${badSecondaryFlag}" ]; then
      case " $* " in *" --active "*) ;; *)
        echo "github.com" >&2
        echo "  X Failed to log in to github.com account other (keyring)" >&2
        echo "  - The token in keyring is invalid." >&2
        exit 1;;
      esac
    fi
    echo "github.com"; echo "  ✓ Logged in to github.com account someone (keyring)"; exit 0;;
  "issue list"|"pr list")
    if [ -e "${apiDownFlag}" ]; then echo "error connecting to api.github.com" >&2; exit 1; fi
    echo "[]"; exit 0;;
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

async function loadWithSyncServiceOnce(
  options: { settings?: Record<string, string> } = {},
) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "github",
    settings: options.settings,
  });
  await plugin(bb);
  // Run the sync service the way the host does at activation. Before the fix
  // its first syncAll() threw NeedsConfigurationError and it stopped for
  // good; the fixed plugin keeps looping, so abort its first pass after the
  // first gh call starts and wait for a clean shutdown.
  const callsBeforeService = ghCalls().length;
  const { controller, done } = harness.runService("sync");
  await vi.waitFor(
    () => {
      expect(ghCalls().length).toBeGreaterThan(callsBeforeService);
    },
    { timeout: 4_000 },
  );
  controller.abort();
  await done;
  return { bb, harness };
}

describe("github plugin gh auth probe (#1758)", () => {
  it("re-probes gh after a transient auth-status failure instead of latching", async () => {
    // 1. gh is "offline" while bb starts (credentials exist, API unreachable).
    writeFileSync(offlineFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    const before = (await harness.callRpc("status")) as {
      ghOk: boolean;
      ghState: string;
    };
    expect(before.ghOk).toBe(false); // probe failed at load, as expected
    expect(before.ghState).toBe("unavailable");
    const callsWhileOffline = ghCalls().length;

    // 2. gh recovers (network back / keychain unlocked). Nothing else changes.
    rmSync(offlineFlag);

    // 3. The plugin is asked for its status (panel banner / `bb github`).
    //    A plugin that re-probes on demand reports ghOk. Before the fix
    //    nothing re-ran `gh auth status`: ghOk stayed false with the stale
    //    error, and not a single further gh call was made.
    const after = (await harness.callRpc("status")) as {
      ghOk: boolean;
      ghState: string;
      ghError: string | null;
    };
    expect(ghCalls().length).toBeGreaterThan(callsWhileOffline);
    expect(after.ghOk).toBe(true);
    expect(after.ghState).toBe("ready");
  });

  it('does not report needs-configuration ("run gh auth login") for a transient probe failure', async () => {
    writeFileSync(offlineFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    // Before the fix both the load-time probe and the sync service latched
    // needs-configuration with the `gh auth login` remedy, although gh holds
    // valid credentials and only the network probe failed.
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("still reports needs-configuration when gh has no credentials at all", async () => {
    writeFileSync(noTokenFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
    expect(harness.needsConfigurationMessages[0]).toContain("gh auth login");
    const status = (await harness.callRpc("status")) as { ghState: string };
    expect(status.ghState).toBe("needs_configuration");
  });

  it("control: with gh working from the start the plugin never reports needs-configuration", async () => {
    const { harness } = await loadWithSyncServiceOnce();
    expect(harness.needsConfigurationMessages).toEqual([]);
    const status = (await harness.callRpc("status")) as { ghOk: boolean };
    expect(status.ghOk).toBe(true);
  });

  it("probes only the active github.com account, so a broken secondary account does not block sync", async () => {
    writeFileSync(badSecondaryFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    expect(harness.needsConfigurationMessages).toEqual([]);
    const status = (await harness.callRpc("status")) as { ghState: string };
    expect(status.ghState).toBe("ready");
    const statusCalls = ghCalls().filter((call) => call.startsWith("auth status"));
    expect(statusCalls.length).toBeGreaterThan(0);
    for (const call of statusCalls) {
      expect(call).toContain("--hostname github.com");
      expect(call).toContain("--active");
    }
    const tokenCalls = ghCalls().filter((call) => call.startsWith("auth token"));
    for (const call of tokenCalls) {
      expect(call).toContain("--hostname github.com");
    }
  });

  it("shares one in-flight probe between concurrent status calls", async () => {
    writeFileSync(offlineFlag, "");
    const { harness } = await loadWithSyncServiceOnce();
    rmSync(offlineFlag);
    writeFileSync(slowStatusFlag, "");
    const callsBefore = ghCalls().length;
    // Panel header and body both ask for status when the panel opens.
    const [a, b] = (await Promise.all([
      harness.callRpc("status"),
      harness.callRpc("status"),
    ])) as Array<{ ghState: string }>;
    expect(a.ghState).toBe("ready");
    expect(b.ghState).toBe("ready");
    const probes = ghCalls()
      .slice(callsBefore)
      .filter((call) => call.startsWith("auth status"));
    expect(probes).toHaveLength(1);
  });

  // Slow the service's auth probe so abort lands while syncAll() is in flight.
  // AbortSignal does not replay an abort to listeners added afterward, so the
  // service must check the signal before starting its retry delay.
  // The 20 s cap leaves process-spawn headroom on the packages shard; the old
  // code deterministically enters its 30 s retry delay.
  it("stops promptly when aborted during an all-repos failure and keeps the old sync time", async () => {
    writeFileSync(apiDownFlag, "");
    writeFileSync(slowStatusFlag, "");
    const { bb, harness } = await loadWithSyncServiceOnce({
      settings: { extraRepos: "acme/one acme/two" },
    });
    rmSync(slowStatusFlag);
    // The sync service must not crash out (the host would stop it during
    // activation) and must not record a successful pass.
    expect(harness.needsConfigurationMessages).toEqual([]);
    expect(await bb.storage.kv.get("sync-cursor")).toBeUndefined();
    expect(harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringMatching(/all 2 repo/),
        }),
      ]),
    );

    // Once GitHub answers again the next pass records a sync time.
    rmSync(apiDownFlag);
    const result = (await harness.callRpc("refresh")) as { repos: number };
    expect(result.repos).toBe(2);
    expect(await bb.storage.kv.get("sync-cursor")).toBeDefined();
  }, 20_000);
});
