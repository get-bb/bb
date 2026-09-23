import { expect, it } from "vitest";
import { runFirstPartyRecordedConformance } from "@bb/provider-bridge-protocol/testing";

it.concurrent.each(["claude-code"])(
  "%s reproduces every recorded matrix cell",
  async (providerId) => {
    const run = await runFirstPartyRecordedConformance({
      servesProvider: (candidate) => candidate === providerId,
      label: providerId,
    });
    expect(run.cells.length).toBeGreaterThan(0);
    console.info(run.report);
    expect(run.failures).toEqual([]);
  },
  240_000,
);
