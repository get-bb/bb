import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerHoldoutCommands } from "../../commands/holdouts.js";

describe("bb holdouts list", () => {
  setupCommandOutputTestEnvironment();
  it("returns persisted assignments as JSON without mutation", async () => {
    const result = {
      assignments: [
        {
          key: "app_aa_check",
          variant: "control",
          assignedAt: 1,
          exposedAt: null,
          appVersion: "1.0.0",
          status: "enrolling",
        },
      ],
    };
    stubServerApi({ "v1.system.holdouts.$get": vi.fn(async () => result) });
    await runCommand(["holdouts", "list", "--json"], (program) =>
      registerHoldoutCommands(program, () => "http://server"),
    );
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
  });
});
