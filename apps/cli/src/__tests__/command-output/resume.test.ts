import { describe, expect, it, vi } from "vitest";
import type { SystemLapsedResumeResult } from "@bb/sdk/node";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerResumeCommands } from "../../commands/resume.js";

const available: SystemLapsedResumeResult = {
  lapsed: true,
  lastActivityAt: Date.UTC(2026, 9, 1),
  target: { threadId: "thr_waiting", projectId: "proj_1" },
  threads: [
    {
      threadId: "thr_waiting",
      projectId: "proj_1",
      title: "Review draft",
      status: "idle",
      reason: "waiting",
    },
    {
      threadId: "thr_finished",
      projectId: "proj_1",
      title: "Build complete",
      status: "idle",
      reason: "finished",
    },
  ],
  suggestionAnalyticsId: "suggestion_1",
};

const unavailable: SystemLapsedResumeResult = {
  lapsed: false,
  lastActivityAt: null,
  target: null,
  threads: [],
  suggestionAnalyticsId: null,
};

describe("bb resume command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerResumeCommands(program, () => "http://server");

  it("allows repeated inspection without claiming the app's return", async () => {
    const read = vi.fn(async () => available);
    const claim = vi.fn(async () => unavailable);
    stubServerApi({
      "v1.system.lapsed-resume.$get": read,
      "v1.system.lapsed-resume.open.$post": claim,
    });

    await runCommand(["resume", "status", "--json"], register);
    await runCommand(["resume", "status", "--json"], register);

    expect(read).toHaveBeenCalledTimes(2);
    expect(claim).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify(available, null, 2),
    );
  });

  it("claims once per invocation and preserves a missing target in JSON", async () => {
    const read = vi.fn(async () => available);
    const claim = vi.fn(async () => unavailable);
    stubServerApi({
      "v1.system.lapsed-resume.$get": read,
      "v1.system.lapsed-resume.open.$post": claim,
    });

    await runCommand(["resume", "open", "--json"], register);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(unavailable, null, 2),
    );
  });

  it("distinguishes waiting threads and finished results in readable output", async () => {
    stubServerApi({ "v1.system.lapsed-resume.$get": async () => available });

    await runCommand(["resume", "status"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines).toContain("Resume thread: thr_waiting (project proj_1)");
    expect(lines).toContain("Waiting on you: Review draft (thr_waiting)");
    expect(lines).toContain("Finished: Build complete (thr_finished)");
  });
});
