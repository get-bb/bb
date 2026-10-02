import { availableParallelism } from "node:os";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import hostEntry from "./host.js";

describe("Concurrency limit host entry", () => {
  it("reports the host's available parallelism", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);

    await expect(
      harness.experimental_call("getCapacity", null),
    ).resolves.toEqual({ availableParallelism: availableParallelism() });
    await harness.experimental_dispose();
  });
});
