import { describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { registerAsyncQuestions } from "./async-questions.js";
import { CODEX_ASYNC_QUESTION_RENDERER_ID } from "./async-question-form.js";

const THREAD_ID = "thr_async";

function questionRow(seq: number) {
  return {
    id: `event-${seq}`,
    threadId: THREAD_ID,
    seq,
    createdAt: seq,
    scope: { kind: "thread" },
    type: "thread/extensionState/updated",
    data: {
      kind: "provider-codex/async-question",
      payload: {
        itemId: `call-${seq}`,
        questions: [{ title: "Choose a, b, or c.", options: ["a", "b", "c"] }],
      },
    },
  };
}

function createHost(rows: ReturnType<typeof questionRow>[]): FakePluginHost {
  const host = createFakePluginHost({ pluginId: "provider-codex" });
  host.harness.sdk.stub(
    "threads.events.list",
    async (args: { afterSeq: string }) =>
      rows.filter((row) => row.seq > Number(args.afterSeq)),
  );
  host.harness.sdk.stub("threads.send", async () => ({}));
  registerAsyncQuestions(
    host.bb as unknown as Parameters<typeof registerAsyncQuestions>[0],
  );
  return host;
}

async function notify(host: FakePluginHost, providerId = "codex") {
  await host.harness.emitThreadEvent("experimental_thread.events", {
    thread: makeThreadResponse({ id: THREAD_ID, providerId }),
    sequence: 10,
  });
}

describe("Codex async questions", () => {
  it("asks once in the thread and sends the answer as a message", async () => {
    const host = createHost([questionRow(5)]);

    await notify(host);
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    const pending = host.harness.pendingInteractions[0]!;
    expect(pending).toMatchObject({
      threadId: THREAD_ID,
      rendererId: CODEX_ASYNC_QUESTION_RENDERER_ID,
      presentation: {
        label: { pending: "Asking a question", completed: "Asked a question" },
      },
      payload: {
        questions: [{ title: "Choose a, b, or c.", options: ["a", "b", "c"] }],
      },
    });

    await notify(host);
    host.harness.submitInteraction(pending.id, {
      answers: { "question-1": { selected: ["option-2"] } },
    });

    await vi.waitFor(() =>
      expect(host.harness.sdk.callsTo("threads.send")).toEqual([
        [
          {
            threadId: THREAD_ID,
            mode: "auto",
            input: [
              {
                type: "text",
                text: "> Choose a, b, or c.\n\nb",
                mentions: [],
              },
            ],
          },
        ],
      ]),
    );
    await vi.waitFor(() =>
      expect(host.harness.sdk.callsTo("threads.events.list")).toHaveLength(2),
    );
    expect(host.harness.sdk.callsTo("threads.events.list")[1]?.[0]).toEqual(
      expect.objectContaining({ afterSeq: "5" }),
    );
    expect(host.harness.pendingInteractions).toHaveLength(0);
    expect(await pending.describeSubmission?.({ answers: {} })).toEqual({
      title: "Answered",
    });
  });

  it("does not send anything when the question is dismissed", async () => {
    const host = createHost([questionRow(5)]);

    await notify(host);
    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(1),
    );
    host.harness.cancelInteraction(host.harness.pendingInteractions[0]!.id);

    await vi.waitFor(() =>
      expect(host.harness.pendingInteractions).toHaveLength(0),
    );
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("ignores threads from other providers", async () => {
    const host = createHost([questionRow(5)]);

    await notify(host, "claude-code");

    expect(host.harness.sdk.callsTo("threads.events.list")).toEqual([]);
  });
});
