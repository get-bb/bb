import { expect, it, vi } from "vitest";
import { PiRpcSession, type PiRpcEvent } from "./rpc-session.js";

const COMPACTION_REJECTION =
  "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.";

function harness(
  requestOk: (command: Record<string, unknown>) => Promise<unknown>,
) {
  const events: PiRpcEvent[] = [];
  const onDone = vi.fn();
  const request = vi.fn(requestOk);
  const session = new PiRpcSession(
    {
      cwd: ".",
      sessionFilePath: "unused",
      sessionDir: ".",
      scratchDir: ".",
      extensionPath: "unused",
      recordThreadId: "compaction-queue-test",
    },
    async () => ({ content: "" }),
    (event) => {
      events.push(event);
    },
    onDone,
  );
  const control = session as unknown as {
    child: unknown;
    isProcessing: boolean;
    handleEvent(event: PiRpcEvent): void;
    handleChannelMessage(message: Record<string, unknown>): void;
  };
  control.child = {
    exited: false,
    requestOk: request,
    request: vi.fn(async () => ({ success: true })),
    closeGracefully: vi.fn(),
    kill: vi.fn(),
  };
  control.handleChannelMessage({ kind: "ready", agentSettled: false });
  const promptCalls = () =>
    request.mock.calls.filter(([command]) => command.type === "prompt");
  const finishRun = () => {
    control.handleEvent({ type: "agent_start" });
    control.handleChannelMessage({ kind: "agent-end-leaf", leafId: "leaf" });
    control.handleEvent({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
  };
  return { session, control, events, onDone, promptCalls, finishRun };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

it("accepts a prompt sent during a Pi manual compaction and dispatches it after compaction ends", async () => {
  const h = harness(async () => undefined);
  h.control.handleEvent({ type: "compaction_start", reason: "manual" });

  const dispatch = h.session.prompt("queued during compaction");
  await dispatch.consumed;
  await flush();
  expect(h.promptCalls()).toHaveLength(0);

  h.control.handleEvent({
    type: "compaction_end",
    reason: "manual",
    aborted: false,
  });
  expect(h.control.isProcessing).toBe(true);
  await flush();
  expect(h.promptCalls()).toHaveLength(1);
  expect(h.promptCalls()[0]?.[0]).toMatchObject({
    type: "prompt",
    message: "queued during compaction",
  });

  h.finishRun();
  expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
  expect(h.onDone).not.toHaveBeenCalled();
});

it("retries a prompt Pi rejected because a manual compaction started before bb observed it", async () => {
  let compacting = true;
  const h = harness(async (command) => {
    if (command.type === "prompt" && compacting) {
      throw new Error(COMPACTION_REJECTION);
    }
    return undefined;
  });

  const dispatch = h.session.prompt("raced with compaction");
  h.control.handleEvent({ type: "compaction_start", reason: "manual" });
  await dispatch.consumed;
  expect(h.promptCalls()).toHaveLength(1);

  compacting = false;
  h.control.handleEvent({
    type: "compaction_end",
    reason: "manual",
    aborted: false,
  });
  await flush();
  expect(h.promptCalls()).toHaveLength(2);

  h.finishRun();
  expect(await dispatch.settled).toEqual({ boundaryDelivered: true });
  expect(h.onDone).not.toHaveBeenCalled();
});

it("fails a prompt queued behind compaction when the session closes before compaction ends", async () => {
  const h = harness(async () => undefined);
  h.control.handleEvent({ type: "compaction_start", reason: "manual" });

  const dispatch = h.session.prompt("never sent");
  await dispatch.consumed;
  await h.session.closeGracefully(10);

  const outcome = await dispatch.settled;
  expect(outcome).toEqual({
    error: new Error("Pi session closed before queued input was sent"),
  });
  expect(h.promptCalls()).toHaveLength(0);
});

it("still surfaces unrelated prompt rejections without waiting", async () => {
  const h = harness(async (command) => {
    if (command.type === "prompt") {
      throw new Error("Unknown model");
    }
    return undefined;
  });

  const dispatch = h.session.prompt("bad");
  await expect(dispatch.consumed).rejects.toThrow("Unknown model");
  expect(await dispatch.settled).toEqual({ error: new Error("Unknown model") });
  expect(h.promptCalls()).toHaveLength(1);
});
