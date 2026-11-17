import {
  getThread,
  listQueuedThreadMessages,
  setAiServiceSelection,
  updateThread,
} from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

const HANDOFF = "Compare the release checklist with the deployment runbook";
const completeTitle = vi.fn<(prompt: string) => Promise<string>>();

afterEach(() => {
  completeTitle.mockReset();
});

async function setup(
  args: { title?: string | null; requestText?: string } = {},
) {
  const harness = await createTestAppHarness();
  registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    pluginId: "provider-codex",
    builtin: true,
    complete: (prompt) => completeTitle(prompt),
  });
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
    ...(args.title ? { title: args.title } : {}),
  });
  if (!args.title) {
    updateThread(harness.db, harness.deps.hub, thread.id, {
      title: null,
      titleFallback: null,
    });
  }
  if (args.requestText !== undefined) {
    seedThreadRuntimeState(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread",
      inputText: args.requestText,
    });
  }
  const post = async (envelopes: HostDaemonEventEnvelope[]) => {
    const response = await harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(harness),
      body: JSON.stringify({
        sessionId: session.id,
        eventGroups: groupHostDaemonEvents(envelopes),
      }),
    });
    expect(response.status).toBe(200);
  };
  let sequence = 0;
  const userMessage = (
    text: string,
    extra: { clientRequestId?: string; parentToolCallId?: string } = {},
  ): HostDaemonEventEnvelope => ({
    threadId: thread.id,
    event: {
      type: "item/completed",
      threadId: thread.id,
      providerThreadId: "provider-thread",
      scope: turnScope("native-turn"),
      item: {
        type: "userMessage",
        id: `handoff-${++sequence}`,
        content: [{ type: "text", text }],
        ...extra,
      },
    } as HostDaemonEventEnvelope["event"],
  });
  const turnStarted: HostDaemonEventEnvelope = {
    threadId: thread.id,
    event: {
      type: "turn/started",
      threadId: thread.id,
      providerThreadId: "provider-thread",
      scope: turnScope("native-turn"),
    },
  };
  const title = () => getThread(harness.db, thread.id)?.title ?? null;
  return { harness, thread, post, userMessage, turnStarted, title };
}

describe("titles from native provider input", () => {
  it("titles an untitled initialized thread from a native handoff through the AI service", async () => {
    const t = await setup({ requestText: "" });
    completeTitle.mockResolvedValue("Release checklist review");
    try {
      const eventsBefore = listEvents(t.harness.db, {
        threadId: t.thread.id,
      }).length;
      await t.post([t.turnStarted, t.userMessage(HANDOFF)]);
      await vi.waitFor(() =>
        expect(t.title()).toBe("Release checklist review"),
      );
      expect(completeTitle).toHaveBeenCalledOnce();
      expect(completeTitle.mock.calls[0]?.[0]).toContain(HANDOFF);
      const newEvents = listEvents(t.harness.db, {
        threadId: t.thread.id,
      }).slice(eventsBefore);
      expect(newEvents.map((event) => event.type)).not.toContain(
        "client/turn/requested",
      );
      expect(listQueuedThreadMessages(t.harness.db, t.thread.id)).toEqual([]);
    } finally {
      await t.harness.cleanup();
    }
  });

  it("does not title from typed request echoes, nested agent input or threads with a typed task", async () => {
    const typed = await setup();
    const withTask = await setup({
      requestText: "Plan the migration to the new storage layer",
    });
    try {
      await typed.post([
        typed.turnStarted,
        typed.userMessage(HANDOFF, { clientRequestId: "creq_abcdefghjk" }),
        typed.userMessage(HANDOFF, { parentToolCallId: "delegation-item" }),
      ]);
      await withTask.post([
        withTask.turnStarted,
        withTask.userMessage(HANDOFF),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(completeTitle).not.toHaveBeenCalled();
      expect(typed.title()).toBeNull();
      expect(withTask.title()).toBeNull();
    } finally {
      await typed.harness.cleanup();
      await withTask.harness.cleanup();
    }
  });

  it("skips greetings below the existing title threshold and retries on a later handoff", async () => {
    const t = await setup();
    completeTitle.mockResolvedValue("Release checklist review");
    try {
      await t.post([t.turnStarted, t.userMessage("Hi there")]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(completeTitle).not.toHaveBeenCalled();
      await t.post([t.userMessage(HANDOFF)]);
      await vi.waitFor(() =>
        expect(t.title()).toBe("Release checklist review"),
      );
    } finally {
      await t.harness.cleanup();
    }
  });

  it("keeps a manual title set while generation is pending and generates once per thread at a time", async () => {
    const t = await setup();
    let finish!: (title: string) => void;
    completeTitle.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    try {
      await t.post([
        t.turnStarted,
        t.userMessage(HANDOFF),
        t.userMessage(`${HANDOFF} again`),
      ]);
      await vi.waitFor(() => expect(completeTitle).toHaveBeenCalledOnce());
      updateThread(t.harness.db, t.harness.deps.hub, t.thread.id, {
        title: "My own title",
      });
      finish("Generated title");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(t.title()).toBe("My own title");
      expect(completeTitle).toHaveBeenCalledOnce();
    } finally {
      await t.harness.cleanup();
    }
  });

  it("keeps a bounded visible fallback when the title service is off", async () => {
    const t = await setup({ requestText: "" });
    setAiServiceSelection(t.harness.db, "thread-title", { mode: "off" });
    const longRequest = `${HANDOFF} ${"and every follow-up detail ".repeat(20)}`;
    try {
      await t.post([t.turnStarted, t.userMessage(longRequest)]);
      await vi.waitFor(() =>
        expect(getThread(t.harness.db, t.thread.id)?.titleFallback).toMatch(
          /^Compare the release checklist.*\.\.\.$/u,
        ),
      );
      const fallback =
        getThread(t.harness.db, t.thread.id)?.titleFallback ?? "";
      expect(fallback.length).toBeLessThanOrEqual(80);
      expect(t.title()).toBeNull();
      expect(completeTitle).not.toHaveBeenCalled();
      updateThread(t.harness.db, t.harness.deps.hub, t.thread.id, {
        titleFallback: "Kept fallback",
      });
      await t.post([t.userMessage(`${HANDOFF} once more`)]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getThread(t.harness.db, t.thread.id)?.titleFallback).toBe(
        "Kept fallback",
      );
    } finally {
      await t.harness.cleanup();
    }
  });

  it("leaves existing titles untouched", async () => {
    const t = await setup({ title: "Existing title" });
    try {
      await t.post([t.turnStarted, t.userMessage(HANDOFF)]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(completeTitle).not.toHaveBeenCalled();
      expect(t.title()).toBe("Existing title");
    } finally {
      await t.harness.cleanup();
    }
  });
});
