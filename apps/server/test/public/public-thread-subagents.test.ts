import { describe, expect, it, vi } from "vitest";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";
import { runLiveHostCommand } from "../../src/services/hosts/live-command.js";

vi.mock("../../src/services/hosts/live-command.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/services/hosts/live-command.js")
    >();
  return { ...actual, runLiveHostCommand: vi.fn() };
});

const child = {
  childRef: "child-1",
  parentToolCallId: "call-1",
  label: "CHILD_ALPHA",
  subagentType: "general-purpose",
  status: "running",
} as const;

describe("public thread subagent routes", () => {
  it("lists, messages, and cancels through the shared host command path", async () => {
    const liveCommand = vi.mocked(runLiveHostCommand);
    liveCommand.mockReset();
    liveCommand.mockImplementation(async () => ({ subagents: [child] }));

    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, {
        id: "host-subagents",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
        path: "/tmp/subagents",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-subagents",
      });

      const list = await harness.app.request(
        `/api/v1/threads/${thread.id}/subagents`,
      );
      expect(list.status).toBe(200);
      expect(await readJson(list)).toEqual([child]);
      expect(liveCommand).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          command: expect.objectContaining({ type: "subagent.list" }),
        }),
      );

      liveCommand.mockResolvedValue({
        childRef: "child-1",
        messageId: "message-1",
      });
      const text = "Hello 😀 مراجعة";
      const tell = await harness.app.request(
        `/api/v1/threads/${thread.id}/subagents/tell`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childRef: "child-1", text }),
        },
      );
      expect(tell.status).toBe(200);
      expect(await readJson(tell)).toEqual({
        childRef: "child-1",
        messageId: "message-1",
      });
      expect(liveCommand).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          command: expect.objectContaining({
            type: "subagent.tell",
            childRef: "child-1",
            text,
          }),
        }),
      );

      liveCommand.mockResolvedValue({
        childRef: "child-1",
        status: "cancelled",
      });
      const cancel = await harness.app.request(
        `/api/v1/threads/${thread.id}/subagents/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childRef: "child-1" }),
        },
      );
      expect(cancel.status).toBe(200);
      expect(await readJson(cancel)).toEqual({
        childRef: "child-1",
        status: "cancelled",
      });
      expect(liveCommand).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({
          command: expect.objectContaining({
            type: "subagent.cancel",
            childRef: "child-1",
          }),
        }),
      );
    });
  });

  it("rejects blank messages before reaching the host", async () => {
    const liveCommand = vi.mocked(runLiveHostCommand);
    liveCommand.mockReset();

    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps, { id: "host-blank" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: session.hostId,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: session.hostId,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/subagents/tell`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childRef: "child-1", text: "  " }),
        },
      );
      expect({
        status: response.status,
        body: await readJson(response),
      }).toMatchObject({
        status: 400,
        body: { code: "invalid_request" },
      });
      expect(liveCommand).not.toHaveBeenCalled();
    });
  });
});
