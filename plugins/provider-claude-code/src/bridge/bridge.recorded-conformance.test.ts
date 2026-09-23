import { expect, it } from "vitest";
import { runFirstPartyRecordedConformance } from "@bb/provider-bridge-protocol/testing";

// bb-fork(windows): the recorded matrix replay does not finish within its
// budget on Windows.
it.skipIf(process.platform === "win32")(
  "reproduces every recorded matrix cell",
  async () => {
    const run = await runFirstPartyRecordedConformance({
      servesProvider: (providerId) => providerId === "claude-code",
      label: "claude-code",
    });
    expect(run.cells.length).toBeGreaterThan(0);
    console.info(run.report);
    expect(run.failures).toEqual([]);
  },
  240_000,
);
