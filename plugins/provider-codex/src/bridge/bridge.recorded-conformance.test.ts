import { expect, it } from "vitest";
import { runFirstPartyRecordedConformance } from "@bb/provider-bridge-protocol/testing";

/**
 * Recorded-traffic conformance for the codex bridge: every committed recording
 * of the live-QA matrix core (turn, steer, stop, approval allow/deny,
 * question, resume, fork) is replayed through this checkout's bridge, with
 * the recorded provider lines as the child, and judged by the kit's
 * recorded-cell rules. The scripted suite beside this one proves the
 * protocol; this one proves the real dialect, as the CLI emitted it on the
 * day of the recording (see each cell's manifest.json for the version).
 */
it("reproduces every recorded matrix cell", async () => {
  const run = await runFirstPartyRecordedConformance({
    servesProvider: (providerId) => providerId === "codex",
    label: "codex",
  });
  expect(run.cells.length).toBeGreaterThan(0);
  console.info(run.report);
  expect(run.failures).toEqual([]);
}, 240_000);
