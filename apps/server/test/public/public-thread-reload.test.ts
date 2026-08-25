import {
  createPendingInteraction,
  createQueuedThreadMessage,
  listEvents,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function registerReloadResponder(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string },
) {
  return registerHostRpcResponder(harness, {
    ...args,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.list_files") {
        return { ok: true, result: { files: [], truncated: false } };
      }
      if (command.type === "host.read_file") {
        if (command.path.endsWith("/AGENTS.md")) {
          return {
            ok: true,
            result: {
              path: command.path,
              content: "Fresh reload instructions",
              contentEncoding: "utf8",
              mimeType: "text/markdown",
              sizeBytes: 25,
              sha256: "0".repeat(64),
            },
          };
        }
        return {
          ok: false,
          errorCode: "ENOENT",
          errorMessage: `Path does not exist: ${command.path}`,
        };
      }
      if (command.type === "thread.reload") {
        return { ok: true, result: { status: "reloaded" } };
      }
      throw new Error(`Unexpected command ${command.type}`);
    },
  });
}

describe("public thread reload", () => {
  it("recreates an idle session from current startup config without adding a timeline message", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, session, thread } = seedThreadFixture(
        harness,
        {
          thread: { status: "idle" },
        },
      );
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-reload",
        threadId: thread.id,
      });
      const responder = registerReloadResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const eventCountBefore = listEvents(harness.db, {
        threadId: thread.id,
      }).length;

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/reload`,
        { method: "POST" },
      );

      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ status: "reloaded" });
      const reloads = responder.requests.filter(
        ({ command }) => command.type === "thread.reload",
      );
      expect(reloads).toHaveLength(1);
      expect(reloads[0]?.command).toMatchObject({
        type: "thread.reload",
        environmentId: environment.id,
        threadId: thread.id,
        providerThreadId: expect.any(String),
        instructions: expect.stringContaining("Fresh reload instructions"),
      });
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(
        eventCountBefore,
      );
    });
  });

  it("reloads a thread whose last turn ended in a provider error", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, session, thread } = seedThreadFixture(harness, {
        thread: { status: "error" },
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-reload-error",
        threadId: thread.id,
      });
      const responder = registerReloadResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/reload`,
        { method: "POST" },
      );

      expect(response.status, JSON.stringify(await readJson(response.clone()))).toBe(200);
      expect(
        responder.requests.filter(({ command }) => command.type === "thread.reload"),
      ).toHaveLength(1);
    });
  });

  it("rejects active threads, queued messages, and pending interactions", async () => {
    await withTestHarness(async (harness) => {
      const active = seedThreadFixture(harness, {
        thread: { status: "active" },
      }).thread;
      const queued = seedThreadFixture(harness, {
        thread: { status: "idle" },
      }).thread;
      createQueuedThreadMessage(harness.db, harness.deps.hub, {
        threadId: queued.id,
        content: [{ type: "text", text: "pending", mentions: [] }],
        model: "test-model",
        reasoningLevel: "medium",
        permissionMode: "auto",
        serviceTier: "default",
        senderThreadId: null,
      });
      const interacting = seedThreadFixture(harness, {
        thread: { status: "idle" },
      }).thread;
      createPendingInteraction(harness.db, {
        originKind: "plugin",
        pluginId: "reload-test",
        rendererId: "reload-test",
        threadId: interacting.id,
        turnId: null,
        payload: JSON.stringify({ kind: "plugin", title: "Pending" }),
      });

      for (const [threadId, message] of [
        [active.id, "only be reloaded while the thread is idle"],
        [queued.id, "has queued messages"],
        [interacting.id, "has a pending interaction"],
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/threads/${threadId}/reload`,
          { method: "POST" },
        );
        expect(response.status).toBe(409);
        await expect(readJson(response)).resolves.toMatchObject({
          message: expect.stringContaining(message),
        });
      }
    });
  });
});
