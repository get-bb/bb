import { expect, it } from "vitest";
import { runFirstPartyRecordedConformance } from "@bb/provider-bridge-protocol/testing";

/**
 * Recorded-traffic conformance for the pi bridge: every committed recording
 * of the live-QA matrix core this provider has (turn, steer, stop, question,
 * resume, fork; pi has no approval cells — approvals are enforced by the
 * runtime) is replayed through this checkout's bridge, with the recorded
 * `pi --mode rpc` lines (and the bb extension's channel) as the child, and
 * judged by the kit's recorded-cell rules. The scripted suite beside this
 * one proves the protocol; this one proves the real RPC dialect, as pi
 * emitted it on the day of the recording (see each cell's manifest.json).
 */
it("reproduces every recorded matrix cell", async () => {
  const run = await runFirstPartyRecordedConformance({
    servesProvider: (providerId) => providerId === "pi",
    label: "pi",
  });
  expect(run.cells).toEqual([
    "fork",
    "resume",
    "steer",
    "stop-interrupt",
    "turn-tools",
    "user-question",
  ]);
  console.info(run.report);
  expect(run.failures).toEqual([]);
}, 240_000);
