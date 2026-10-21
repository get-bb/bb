import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerSetupJobCommands } from "../../commands/setup-job.js";

describe("bb setup-job", () => {
  setupCommandOutputTestEnvironment();
  it("reads without accepting and requires an explicit offer ID to opt in", async () => {
    const read = vi.fn(async () => ({ offer: null }));
    const decide = vi.fn(async () => ({ offer: null }));
    stubServerApi({
      "v1.system.setup-job.$get": read,
      "v1.system.setup-job.decision.$post": decide,
    });
    const register = (
      program: Parameters<typeof registerSetupJobCommands>[0],
    ) => registerSetupJobCommands(program, () => "http://server");
    await runCommand(
      ["setup-job", "show", "--timezone", "UTC", "--json"],
      register,
    );
    expect(read).toHaveBeenCalledWith({ query: { timezone: "UTC" } });
    expect(decide).not.toHaveBeenCalled();
    const id = "26ad88d4-6506-4ba9-a0ed-ccac606c638c";
    await runCommand(
      ["setup-job", "accept", "--offer", id, "--json"],
      register,
    );
    expect(decide).toHaveBeenCalledWith({
      json: { suggestionAnalyticsId: id, accepted: true },
    });
  });
});
