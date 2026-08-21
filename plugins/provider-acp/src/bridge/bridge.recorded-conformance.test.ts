import { expect, it } from "vitest";
import {
  checkRecordedCellReplay,
  formatConformanceReport,
  RECORDED_CONFORMANCE_CELLS,
} from "@bb/provider-bridge-protocol/conformance";
import { replayRecordedCells } from "@bb/provider-bridge-protocol/testing";
import { createBridgeDeltaEventCollector } from "@bb/agent-runtime/test/bridge-delta-assembly";

/**
 * Recorded-traffic conformance for the acp bridge: every committed recording
 * of the live-QA matrix core (turn, steer, stop, approval allow/deny,
 * question, resume, fork) is replayed through this checkout's bridge, with
 * the recorded provider lines as the child, and judged by the kit's
 * recorded-cell rules. The scripted suite beside this one proves the
 * protocol; this one proves the real dialect, as the CLI emitted it on the
 * day of the recording (see each cell's manifest.json for the version).
 */
it("reproduces every recorded matrix cell", async () => {
  const replays = await replayRecordedCells({
    servesProvider: (providerId) => providerId.startsWith("acp-"),
    cells: RECORDED_CONFORMANCE_CELLS,
    createAssembler: (providerId) => {
      const collector = createBridgeDeltaEventCollector(providerId);
      return { assembleMessage: (message) => collector.assembleMessage(message) };
    },
    timeoutMs: 60_000,
    onStderr: (text) => process.stderr.write(`[bridge] ${text}`),
  });
  expect(replays.length).toBeGreaterThan(0);

  const results = replays.flatMap((replay) => checkRecordedCellReplay(replay));
  const report = { results, passed: results.every((result) => result.status === "pass") };
  console.info(`acp recorded conformance:\n${formatConformanceReport(report)}`);

  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => `${result.id}: ${result.detail}`),
  ).toEqual([]);
}, 240_000);
