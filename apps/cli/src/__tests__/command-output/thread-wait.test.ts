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
import { registerThreadCommands } from "../../commands/thread/register-all.js";

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
    stubServerApi({ "v1.threads.:id.wait.$get": get });

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
    stubServerApi({ "v1.threads.:id.wait.$get": get });

    await runCommand(
      ["thread", "wait", "thread-wait", "--status", "idle"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread thread-wait reached status idle.",
    );
  });

  it("bb thread wait preserves the existing JSON bytes", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait-json",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.wait.$get": get });

    await runCommand(
      ["thread", "wait", "thread-wait-json", "--json"],
      register,
    );

    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toBe(
      JSON.stringify(
        {
          threadId: "thread-wait-json",
          matched: true,
          target: { kind: "status", status: "idle" },
        },
        null,
        2,
      ),
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
    stubServerApi({ "v1.threads.:id.wait.$get": get });

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
    stubServerApi({ "v1.threads.:id.wait.$get": get });

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

  it("bb thread wait --output preserves unreachable exit without fetching output", async () => {
    const get = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-wait-output-error",
        projectId: "proj-1",
        providerId: "codex",
        status: "error",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const outputGet = vi.fn(async () => ({ output: "PARTIAL" }));
    stubServerApi({
      "v1.threads.:id.wait.$get": get,
      "v1.threads.:id.output.$get": outputGet,
    });

    await expect(
      runCommand(
        ["thread", "wait", "thread-wait-output-error", "--output"],
        register,
      ),
    ).rejects.toThrow("process.exit:4");
    expect(outputGet).not.toHaveBeenCalled();
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

  it("bb thread wait --output waits once and then gets output once", async () => {
    const waitGet = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-follow",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const outputGet = vi.fn(async () => ({ output: "FINAL" }));
    stubServerApi({
      "v1.threads.:id.wait.$get": waitGet,
      "v1.threads.:id.output.$get": outputGet,
    });

    await runCommand(["thread", "wait", "thread-follow", "--output"], register);

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread thread-follow reached status idle.",
      "FINAL",
    ]);
    expect(waitGet).toHaveBeenCalledTimes(1);
    expect(outputGet).toHaveBeenCalledTimes(1);
    expect(waitGet.mock.invocationCallOrder[0]).toBeLessThan(
      outputGet.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("bb thread wait --output --json returns the terminal result shape", async () => {
    const waitGet = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-follow-json",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const outputGet = vi.fn(async () => ({ output: "FINAL" }));
    stubServerApi({
      "v1.threads.:id.wait.$get": waitGet,
      "v1.threads.:id.output.$get": outputGet,
    });

    await runCommand(
      ["thread", "wait", "thread-follow-json", "--output", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({
      output: "FINAL",
      status: "idle",
      threadId: "thread-follow-json",
    });
  });

  it("bb thread wait rejects --output with --event before any request", async () => {
    const waitGet = vi.fn();
    stubServerApi({ "v1.threads.:id.events.wait.$get": waitGet });

    await expect(
      runCommand(
        [
          "thread",
          "wait",
          "thread-event-output",
          "--event",
          "turn/completed",
          "--output",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:3");
    expect(waitGet).not.toHaveBeenCalled();
  });

  it("bb thread wait-many emits one JSON line for each completed output", async () => {
    const waitGet = vi.fn(async (input: { param: { id: string } }) =>
      fixtures.makeThread({
        id: input.param.id,
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const outputGet = vi.fn(async (input: { param: { id: string } }) => ({
      output: `FINAL ${input.param.id}`,
    }));
    stubServerApi({
      "v1.threads.:id.wait.$get": waitGet,
      "v1.threads.:id.output.$get": outputGet,
    });

    await runCommand(
      ["thread", "wait-many", "thread-a", "thread-b", "--output", "--json"],
      register,
    );

    const payloads = vi
      .mocked(console.log)
      .mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(payloads).toEqual([
      { output: "FINAL thread-a", status: "idle", threadId: "thread-a" },
      { output: "FINAL thread-b", status: "idle", threadId: "thread-b" },
    ]);
    expect(waitGet).toHaveBeenCalledTimes(2);
    expect(outputGet).toHaveBeenCalledTimes(2);
  });

  it("bb thread wait-many exits with the worst outcome", async () => {
    const waitGet = vi.fn(async (input: { param: { id: string } }) =>
      fixtures.makeThread({
        id: input.param.id,
        projectId: "proj-1",
        providerId: "codex",
        status: input.param.id === "thread-error" ? "error" : "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.wait.$get": waitGet });

    await expect(
      runCommand(
        ["thread", "wait-many", "thread-ok", "thread-error", "--json"],
        register,
      ),
    ).rejects.toThrow("process.exit:4");

    const payloads = vi
      .mocked(console.log)
      .mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(payloads).toEqual([
      {
        matched: true,
        target: { kind: "status", status: "idle" },
        threadId: "thread-ok",
      },
      {
        error: expect.stringContaining("will not reach idle"),
        exitCode: 4,
        threadId: "thread-error",
      },
    ]);
  });

  it("keeps JSON stdout clean when --poll-interval is explicit", async () => {
    const waitGet = vi.fn(async () =>
      fixtures.makeThread({
        id: "thread-poll-warning",
        projectId: "proj-1",
        providerId: "codex",
        status: "idle",
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    stubServerApi({ "v1.threads.:id.wait.$get": waitGet });

    await runCommand(
      [
        "thread",
        "wait",
        "thread-poll-warning",
        "--poll-interval",
        "10",
        "--json",
      ],
      register,
    );

    expect(() =>
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).not.toThrow();
    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Warning: --poll-interval is deprecated on event-driven servers. It now controls fallback polling and pauses between long-poll rounds.",
    );
  });
});
