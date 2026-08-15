import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  formatConformanceReport,
  runBridgeConformance,
  type BridgeConformanceTransport,
} from "@bb/provider-bridge-protocol/conformance";
import {
  captureBridgeJsonRpcOutput,
  type CapturedBridgeJsonRpcOutput,
} from "../../test/bridge-json-rpc-test-helpers.js";
import { handleLine } from "./bridge.js";

/**
 * The codex bridge's conformance run: drives the bridge through the canonical
 * Provider Bridge Protocol suite against real supervised app-server children
 * — the bridge spawns `fake-codex-app-server.mjs` per session via its
 * app-server command seam, so child spawn, per-child initialize, the
 * notification/request plumbing, and child teardown on release are all
 * exercised for real (not mocked at a module seam).
 *
 * The scripted app-server answers every turn delta-first (an
 * `item/agentMessage/delta` before any `item/started` for that item), so the
 * bridge's item-opening synthesis, bridge-minted id stamping, and
 * cross-resume id uniqueness (fresh entropy-prefixed session serial per
 * construction) are what the kit verifies.
 *
 * KNOWN GAP — `turn/settles-without-activity` fails here, deliberately pinned
 * as "fail" rather than skipped. #1432 gave claude, acp, and pi a shared
 * terminal-turn rule but left codex out on the reasoning that "its native
 * lifecycle already settles this shape". That holds only while the app-server
 * emits `turn/started` for every accepted prompt. When it does not (this
 * fixture's zero-work prompt, and the `thread/compact/start` path, which the
 * bridge dispatches instead of `turn/start`), the bridge accepts the turn,
 * answers the request, and emits nothing: the bb turn never settles and the
 * thread stays active. The runtime's turn-start watchdog surfaces a
 * `provider_turn_start_timeout` system/error after 120s but does not settle
 * the turn.
 *
 * Not fixed here because the fix is not local: the bridge would have to prove
 * ownership before synthesizing a turn (the queued turn-start client request
 * id is the natural proof, but `PreparedProviderCommandDispatch` exposes only
 * `rollback()`, so the seam is a shared-type change), and it must not race a
 * `turn/started` that arrives after the `turn/start` response — fabricating a
 * turn from a late signal is the ACP bug 0c2f4cc9a fixed.
 */

const CONFORMANCE_THREAD_ID = "thr_conformance_1";

const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-conformance-ws-"));
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath]),
  );
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  // Release the session the kit leaves behind (its last scenario resumes and
  // runs a turn) so no fake app-server child outlives the test.
  const cleanupId = 990_001;
  handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: cleanupId,
      method: "thread/stop",
      params: {
        threadId: CONFORMANCE_THREAD_ID,
        providerThreadId: "conformance-cleanup",
        intent: "release",
        activeTurnId: null,
      },
    }),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (output.messages.some((message) => message.id === cleanupId)) {
      break;
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  }
  output.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against supervised fake app-server children", async () => {
  let drained = 0;
  const transport: BridgeConformanceTransport = {
    send: (line) => handleLine(line),
    takeMessages: () => {
      const fresh = output.messages.slice(drained);
      drained = output.messages.length;
      return fresh;
    },
  };

  const report = await runBridgeConformance({
    transport,
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      // The fake app-server accepts this prompt and answers with no
      // turn/started and no turn/completed at all — see the KNOWN GAP note
      // above.
      zeroWorkPromptInput: [{ type: "text", text: "/clear", mentions: [] }],
    },
    timeoutMs: 10_000,
  });

  // Keep the human-readable report visible in test output for diagnosing
  // any regression.
  console.info(`codex bridge conformance:\n${formatConformanceReport(report)}`);

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );

  expect(statusById).toMatchObject({
    "rpc/unknown-method": "pass",
    "rpc/invalid-params": "pass",
    "rpc/non-json-ignored": "pass",
    "rpc/response-not-request": "pass",
    "handshake/initialize": "pass",
    "session/start-identity": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-id-uniqueness": "pass",
    // KNOWN GAP, pinned deliberately: see the file comment. Flipping this to
    // "pass" is a graduation prerequisite.
    "turn/settles-without-activity": "fail",
  });

  // Stronger than `report.passed`: exactly one rule may be non-green, and it
  // must be the known gap. Any other regression fails here.
  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual(["turn/settles-without-activity"]);
}, 60_000);
