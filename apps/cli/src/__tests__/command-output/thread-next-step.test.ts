import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NextStepInput } from "@bb/domain";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread next-step", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it.each([
    { operation: "show", route: "$get" },
    { operation: "accept", route: "accept.$post" },
    { operation: "dismiss", route: "dismiss.$post" },
    { operation: "undo", route: "undo.$post" },
  ])(
    "$operation resolves --self and uses the shared route",
    async ({ operation, route }) => {
      vi.stubEnv("BB_THREAD_ID", "thread-1");
      const handler = vi.fn(async () => null);
      const shown = vi.fn(async () => null);
      stubServerApi({
        [`v1.threads.:id.next-step.${route}`]: handler,
        "v1.threads.:id.next-step.shown.$post": shown,
      });
      await runCommand(
        ["thread", "next-step", operation, "--self", "--json"],
        register,
      );
      expect(handler).toHaveBeenCalledWith({ param: { id: "thread-1" } });
      expect(shown).not.toHaveBeenCalled();
      expect(collectLogLines(vi.mocked(console.log))).toEqual(["null"]);
    },
  );

  it("submits the file as typed proposal input associated with the requested turn", async () => {
    const input: NextStepInput = {
      title: "Triage tomorrow’s CI failures",
      why: "Today’s run found intermittent failures.",
      evidence: [{ source: "conversation", ref: "message-1" }],
      action: {
        kind: "automation",
        automation: {
          prompt: "Triage CI failures",
          schedule: { runAt: 1_800_000_000_000, timezone: "UTC" },
        },
      },
    };
    const directory = await mkdtemp(path.join(tmpdir(), "bb-next-step-cli-"));
    try {
      const file = path.join(directory, "proposal.json");
      await writeFile(file, JSON.stringify(input));
      const propose = vi.fn(async () => ({ id: "proposal-1" }));
      stubServerApi({ "v1.threads.:id.next-step.propose.$post": propose });
      await runCommand(
        [
          "thread",
          "next-step",
          "propose",
          "thread-1",
          "--turn",
          "turn-1",
          "--file",
          file,
          "--json",
        ],
        register,
      );
      expect(propose).toHaveBeenCalledWith({
        param: { id: "thread-1" },
        json: { turnId: "turn-1", input },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
