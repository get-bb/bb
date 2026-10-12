import { describe, expect, it } from "vitest";
import {
  getThread,
  getLastStoredProviderThreadId,
  listStoredEventRows,
  threads,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { threadScope } from "@bb/domain";
import type { ExperimentalThreadProviderHandoverRequest } from "@bb/server-contract";
import {
  handoffThreadProvider,
  providerHandoverState,
} from "../../src/services/threads/thread-provider-handover.js";
import { getLastExecutionOptions } from "../../src/services/threads/thread-events.js";
import { withThreadSendGuard } from "../../src/services/threads/thread-context-mutation-guard.js";
import { availableModelFixture } from "../helpers/available-models.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
} from "../helpers/host-rpc.js";
import {
  seedThreadFixture,
  seedEvent,
  seedQueuedMessage,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function setup(
  harness: TestAppHarness,
  options: { retained?: boolean; failResume?: boolean } = {},
) {
  const fixture = seedThreadFixture(harness, {
    environment: { status: "ready", path: "/tmp/provider-handover" },
    thread: {
      providerId: "claude-code",
      status: "idle",
      title: "Original chat",
    },
  });
  const threadId = fixture.thread.id;
  seedEvent(harness.deps, {
    threadId,
    sequence: 1,
    type: "thread/identity",
    providerThreadId: "local-native",
    scope: threadScope(),
    data: { providerThreadId: "local-native" },
  });
  seedEvent(harness.deps, {
    threadId,
    sequence: 2,
    type: "system/operation",
    scope: threadScope(),
    data: {
      operation: "prior_work",
      operationId: "previous-operation",
      status: "completed",
      message: "Original local history",
    },
  });
  const rpc = registerHostRpcResponder(harness, {
    hostId: fixture.host.id,
    sessionId: fixture.session.id,
    handle: (request) => {
      switch (request.command.type) {
        case "provider.list_models":
          return {
            ok: true,
            result: {
              models: [
                availableModelFixture({
                  model: "target-model",
                  reasoningLevels: ["medium"],
                }),
              ],
              selectedOnlyModels: [],
            },
          };
        case "host.read_workspace_agent_context":
          return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
        case "host.list_skills":
          return { ok: true, result: { skills: [] } };
        case "thread.stop":
          return {
            ok: true,
            result: {
              providerCheckpointId: null,
              activeTurnRetained: options.retained === true,
            },
          };
        case "thread.resume":
          return options.failResume
            ? {
                ok: false,
                errorCode: "offline",
                errorMessage: "Temporarily disconnected",
              }
            : {
                ok: true,
                result: {
                  providerThreadId:
                    request.command.resumeContext.providerThreadId,
                },
              };
        default:
          throw Error("Unexpected handover command: " + request.command.type);
      }
    },
  });
  const request: ExperimentalThreadProviderHandoverRequest = {
    operationId: "handover-unique-1",
    expectedProviderId: "claude-code",
    expectedProviderThreadId: "local-native",
    expectedLatestSeq: 2,
    providerId: "codex",
    providerThreadId: "target-native",
    model: "target-model",
    reasoningLevel: "medium",
    permissionMode: "full",
    serviceTier: "default",
  };
  return { ...fixture, rpc, request };
}

describe("existing-thread provider handover", () => {
  it("validates the public routes and resumes without submitting input", async () => {
    await withTestHarness(async (harness) => {
      const { thread, rpc, request } = setup(harness),
        route = `/api/v1/threads/${thread.id}/provider/`;
      const state = await harness.app.request(route + "handover");
      expect(state.status).toBe(200);
      expect(await state.json()).toMatchObject({
        providerId: "claude-code",
        latestSeq: 2,
        blockedReason: null,
      });
      const invalid = await harness.app.request(route + "handover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, unexpected: true }),
      });
      expect(invalid.status).toBe(400);
      expect(rpc.requests).toHaveLength(0);
      const adopted = await harness.app.request(route + "handover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      expect(adopted.status).toBe(200);
      expect(await adopted.json()).toMatchObject({
        threadId: thread.id,
        runtimeLoaded: true,
      });
      const resumed = await harness.app.request(route + "resume", {
        method: "POST",
      });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toEqual({
        ok: true,
        providerThreadId: "target-native",
      });
      expect(
        rpc.requests.some((row) => row.command.type === "turn.submit"),
      ).toBe(false);
    });
  });
  it("preserves history and organization, resumes without a turn, and retries once", async () => {
    await withTestHarness(async (harness) => {
      const { thread, rpc, request } = setup(harness);
      const result = await handoffThreadProvider(
        harness.deps,
        thread.id,
        request,
      );
      expect(result).toMatchObject({
        reused: false,
        runtimeLoaded: true,
        resumeError: null,
      });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        title: "Original chat",
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        parentThreadId: thread.parentThreadId,
        sectionId: thread.sectionId,
        status: "idle",
        providerId: "codex",
      });
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBe(
        "target-native",
      );
      expect(getLastExecutionOptions(harness.deps, thread.id)).toMatchObject({
        model: "target-model",
        permissionMode: "full",
        source: "system/provider-handover",
      });
      const rows = listStoredEventRows(harness.db, {
        threadId: thread.id,
        limit: 100,
      });
      expect(rows.map((row) => row.type)).toEqual([
        "thread/identity",
        "system/operation",
        "system/operation",
        "thread/identity",
      ]);
      expect(rows[1]?.data).toContain("Original local history");
      await expect(
        handoffThreadProvider(harness.deps, thread.id, request),
      ).resolves.toMatchObject({ reused: true, runtimeLoaded: true });
      expect(
        rpc.requests.filter((row) => row.command.type === "thread.stop"),
      ).toHaveLength(1);
      expect(
        rpc.requests.filter((row) => row.command.type === "thread.resume"),
      ).toHaveLength(2);
      expect(
        rpc.requests.some((row) =>
          ["thread.start", "turn.submit"].includes(row.command.type),
        ),
      ).toBe(false);
      expect(
        listStoredEventRows(harness.db, { threadId: thread.id, limit: 100 }),
      ).toHaveLength(4);
    });
  });
  it.each(["source", "sequence", "queue", "active"] as const)(
    "refuses changed or busy %s before releasing the local provider",
    async (reason) => {
      await withTestHarness(async (harness) => {
        const { thread, rpc, request } = setup(harness);
        if (reason === "source")
          request.expectedProviderThreadId = "different-local-session";
        if (reason === "sequence") request.expectedLatestSeq = 1;
        if (reason === "queue")
          seedQueuedMessage(harness.deps, {
            threadId: thread.id,
            content: [{ type: "text", text: "Waiting input", mentions: [] }],
          });
        if (reason === "active")
          harness.db
            .update(threads)
            .set({ status: "active" })
            .where(eq(threads.id, thread.id))
            .run();
        await expect(
          handoffThreadProvider(harness.deps, thread.id, request),
        ).rejects.toMatchObject({ status: 409 });
        expect(rpc.requests).toHaveLength(0);
        expect(getThread(harness.db, thread.id)?.providerId).toBe(
          "claude-code",
        );
      });
    },
  );
  it("refuses a runtime that retained an active turn instead of interrupting it", async () => {
    await withTestHarness(async (harness) => {
      const { thread, rpc, request } = setup(harness, { retained: true });
      await expect(
        handoffThreadProvider(harness.deps, thread.id, request),
      ).rejects.toMatchObject({ status: 409 });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(
        rpc.requests
          .filter((row) => row.command.type === "thread.stop")
          .map((row) => row.command),
      ).toEqual([expect.objectContaining({ intent: "release" })]);
      expect(
        rpc.requests.some((row) => row.command.type === "thread.resume"),
      ).toBe(false);
    });
  });
  it("retains a durable handover when resume disconnects and retries without another release", async () => {
    await withTestHarness(async (harness) => {
      const { thread, rpc, request } = setup(harness, { failResume: true });
      const result = await handoffThreadProvider(
        harness.deps,
        thread.id,
        request,
      );
      expect(result.runtimeLoaded).toBe(false);
      expect(result.resumeError).toContain("Temporarily disconnected");
      expect(providerHandoverState(harness.deps, thread.id).providerId).toBe(
        "codex",
      );
      await expect(
        handoffThreadProvider(harness.deps, thread.id, request),
      ).resolves.toMatchObject({ reused: true, runtimeLoaded: false });
      expect(
        rpc.requests.filter((row) => row.command.type === "thread.stop"),
      ).toHaveLength(1);
    });
  });
  it("rolls back provider and history changes when another thread owns the target session", async () => {
    await withTestHarness(async (harness) => {
      const { thread, request } = setup(harness);
      const other = seedThread(harness.deps, {
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        providerId: "codex",
      });
      seedEvent(harness.deps, {
        threadId: other.id,
        sequence: 1,
        type: "thread/identity",
        providerThreadId: "target-native",
        scope: threadScope(),
        data: { providerThreadId: "target-native" },
        createdAt: Date.now() - 1000,
      });
      await expect(
        handoffThreadProvider(harness.deps, thread.id, request),
      ).rejects.toMatchObject({ status: 409 });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBe(
        "local-native",
      );
      expect(
        listStoredEventRows(harness.db, { threadId: thread.id, limit: 100 }),
      ).toHaveLength(2);
    });
  });
  it("cannot adopt while another send owns the dispatch guard", async () => {
    await withTestHarness(async (harness) => {
      const { thread, request } = setup(harness);
      await withThreadSendGuard(thread.id, async () => {
        await expect(
          handoffThreadProvider(harness.deps, thread.id, request),
        ).rejects.toMatchObject({ status: 409 });
      });
    });
  });
});
