import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread placement command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("names the machine a placement plugin would choose", async () => {
    const get = vi.fn(async () => ({
      kind: "host",
      hostId: "host_studio",
      hostName: "Mac Studio",
      skipped: [
        { hostId: "host_air", hostName: "Air", reason: "Codex not signed in" },
      ],
    }));
    stubServerApi({ "v1.threads.placement-preview.$get": get });

    await runCommand(
      ["thread", "placement", "--project", "proj_a", "--provider", "codex"],
      register,
    );

    expect(get).toHaveBeenCalledWith({
      query: { projectId: "proj_a", providerId: "codex" },
    });
    expect(vi.mocked(console.log).mock.calls.map((call) => call[0])).toEqual([
      "Mac Studio (host_studio)",
      "  Air skipped: Codex not signed in",
    ]);
  });

  it("distinguishes a missing placement plugin from a declined choice", async () => {
    stubServerApi({
      "v1.threads.placement-preview.$get": vi.fn(async () => ({
        kind: "unavailable",
      })),
    });
    await runCommand(
      ["thread", "placement", "--project", "proj_a", "--provider", "codex"],
      register,
    );
    stubServerApi({
      "v1.threads.placement-preview.$get": vi.fn(async () => ({
        kind: "default",
        skipped: [],
      })),
    });
    await runCommand(
      ["thread", "placement", "--project", "proj_a", "--provider", "codex"],
      register,
    );

    expect(vi.mocked(console.log).mock.calls.map((call) => call[0])).toEqual([
      "Server default: no placement plugin is installed",
      "Server default: no placement plugin chose a ready machine",
    ]);
  });
});
