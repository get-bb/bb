import { describe, expect, it, vi } from "vitest";
import * as domain from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread wait command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread wait defaults to waiting for idle", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait-default",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.$get": get });

    await runCommand(["thread", "wait", "thread-wait-default"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-wait-default reached status idle.",
    );
  });

  it("bb thread wait --status succeeds when the thread is already at the requested status", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.$get": get });

    await runCommand(
      ["thread", "wait", "thread-wait", "--status", "idle"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-wait reached status idle.",
    );
  });

  it("bb thread wait --status exits with timeout code when the status is not reached", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait-timeout",
        projectId: "proj-1",
        providerId: "codex",
        status: "active",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.$get": get });

    await expect(
      runCommand(
        [
          "thread",
          "wait",
          "thread-wait-timeout",
          "--status",
          "idle",
          "--timeout",
          "0",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:2");
  });

  it("bb thread wait --status idle fails fast when the thread is stuck in error", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait-error",
        projectId: "proj-1",
        providerId: "codex",
        status: "error",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.$get": get });

    await expect(
      runCommand(
        ["thread", "wait", "thread-wait-error", "--status", "idle"],
        register,
      ),
    ).rejects.toThrow("process.exit:4");

    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Thread thread-wait-error is in status error and will not reach idle by waiting alone. Inspect it with 'bb thread show thread-wait-error' and recover by sending a follow-up.",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("bb thread wait --event reports server errors instead of schema errors", async () => {
    const waitGet = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: "not_found", message: "Thread not found" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    stubServerApi({ "v1.threads.:id.events.wait.$get": waitGet });

    await expect(
      runCommand(
        [
          "thread",
          "wait",
          "thread-404",
          "--event",
          "turn/completed",
          "--timeout",
          "5",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    const errorLines = collectLogLines(vi.mocked(console.error));
    const hasServerError = errorLines.some(
      (line) => line.includes("404") && !line.includes("ZodError"),
    );
    expect(hasServerError).toBe(true);
  });

  it("bb thread wait --event --timeout 0 returns immediately when event exists", async () => {
    const waitGet = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...domain.buildThreadEventRow({
              id: "evt-1",
              scope: domain.turnScope("turn-1"),
              threadId: "thread-t0",
              seq: 3,
              createdAt: Date.now(),
              event: {
                type: "turn/completed",
                threadId: "thread-t0",
                providerThreadId: "provider-thread-t0",
                turnId: "turn-1",
                scope: domain.turnScope("turn-1"),
                status: "completed",
              },
            }),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    stubServerApi({ "v1.threads.:id.events.wait.$get": waitGet });

    await runCommand(
      [
        "thread",
        "wait",
        "thread-t0",
        "--event",
        "turn/completed",
        "--timeout",
        "0",
      ],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-t0 observed event turn/completed at seq 3.",
    );
  });
});
