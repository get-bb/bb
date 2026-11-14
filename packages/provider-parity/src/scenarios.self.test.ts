import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatConformanceReport } from "@bb/provider-bridge-protocol/conformance";
import { readBridgeRecording } from "@bb/provider-bridge-protocol/testing";
import {
  checkRecordedScenarioReplay,
  listScenarioCells,
  readScenarioKnownGaps,
  replayScenarioCell,
} from "@bb/provider-bridge-protocol/scenarios";
import { cellKey, createParityAssembler } from "./index.js";

const checkoutRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cells = listScenarioCells();

const knownGaps = readScenarioKnownGaps();

describe("known gaps", () => {
  it("name a recorded cell and a reason", () => {
    const recorded = new Set(cells.map(cellKey));
    for (const gap of knownGaps) {
      expect(recorded).toContain(`${gap.provider}/${gap.cell}`);
      expect(gap.check.startsWith(`scenario/${gap.cell}/`)).toBe(true);
    }
  });
});

describe("recorded bridge scenarios", () => {
  it.concurrent.each(cells.map((cell) => [cellKey(cell), cell] as const))(
    "%s keeps every scenario rule",
    async (_key, cell) => {
      const replay = await replayScenarioCell(cell, {
        checkoutRoot,
        createAssembler: createParityAssembler,
        timeoutMs: 60_000,
      });
      const results = checkRecordedScenarioReplay({
        provider: cell.provider,
        cell: cell.cell,
        recording: readBridgeRecording(cell.dir).entries,
        bridgeLines: replay.run.lines,
        events: replay.run.events,
        grammarViolations: replay.run.grammarViolations,
        providerInputs: replay.providerInputs,
        divergence: replay.divergence,
      });
      console.info(
        `${cellKey(cell)} scenario rules:\n${formatConformanceReport({
          results,
          passed: results.every((check) => check.status !== "fail"),
        })}`,
      );
      if (replay.divergence.length > 0) {
        const driftSkips = results
          .filter(
            (check) =>
              check.status === "skipped" &&
              check.detail.startsWith("the bridge no longer talks"),
          )
          .map((check) => check.id);
        process.stderr.write(
          `\n${cellKey(cell)} needs re-recording: its replay drifted from the recording (${replay.divergence[0]!.slice(0, 300)}), so ${driftSkips.length === 0 ? "no rule" : driftSkips.join(", ")} was skipped. Re-record it with: node scripts/provider-recordings/record-scenario-cell.mjs --provider ${cell.provider} --cell ${cell.cell} --raw <dir>\n`,
        );
      }
      const gaps = knownGaps.filter(
        (gap) => gap.provider === cell.provider && gap.cell === cell.cell,
      );
      expect({
        newFailures: results
          .filter(
            (check) =>
              check.status === "fail" &&
              !gaps.some((gap) => gap.check === check.id),
          )
          .map((check) => `${check.id}: ${check.detail}`),
        fixedGaps: gaps
          .filter(
            (gap) =>
              !results.some(
                (check) => check.id === gap.check && check.status === "fail",
              ),
          )
          .map(
            (gap) =>
              `${gap.check} passes now; remove it from recordings/scenarios/known-gaps.json`,
          ),
      }).toEqual({ newFailures: [], fixedGaps: [] });
    },
    240_000,
  );
});
