// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it, vi } from "vitest";
import { bill, stepper } from "./examples.js";

const answer = {
  id: "e85d6718-895b-48e5-8bc4-2a9bd3477895",
  threadId: "thr_test",
  kind: "document" as const,
  document: bill,
};
const props = {
  attributes: { id: answer.id },
  source: "",
  message: {
    id: "msg_1",
    threadId: answer.threadId,
    turnId: null,
    projectId: null,
  },
  openWorkspaceFile: null,
};
afterEach(() => {
  cleanup();
});

function server(kind: "document" | "html" = "document") {
  const shared = { state: null as unknown, version: 0 };
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  const log =
    <T,>(method: string, run: (input: Record<string, unknown>) => T) =>
    (input: unknown) => {
      calls.push({ method, input: input as Record<string, unknown> });
      return run(input as Record<string, unknown>);
    };
  return {
    shared,
    calls,
    clientId: () =>
      calls.find((c) => c.method === "presence")!.input.clientId as string,
    rpc: {
      get: log("get", () =>
        kind === "html"
          ? {
              id: answer.id,
              threadId: answer.threadId,
              kind: "html" as const,
              widget: stepper,
            }
          : answer,
      ),
      getState: log("getState", () => ({ ...shared })),
      setState: log("setState", ({ state }) => {
        shared.state = state;
        shared.version += 1;
        return { version: shared.version };
      }),
      presence: log("presence", () => ({ ok: true as const })),
      event: log("event", () => ({ seq: 1 })),
      result: log("result", () => ({ ok: true as const })),
      share: log("share", () => ({ itemId: `${answer.id}.12` })),
    },
  };
}

it("saves inputs to the shared answer state, restores them on remount, resets, and switches representations", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const backend = server();
  const first = renderSlot(app.messageDirectives[0]!, props, {
    rpc: backend.rpc,
  });
  await first.findByText("$36.00");
  fireEvent.change(first.getByLabelText("People"), { target: { value: "6" } });
  expect(first.getByText("$24.00", { selector: "dd" })).toBeTruthy();
  await waitFor(() =>
    expect(backend.shared.state).toMatchObject({ people: 6 }),
  );
  first.lifecycle.unmount();
  const view = renderSlot(app.messageDirectives[0]!, props, {
    rpc: backend.rpc,
  });
  await view.findByText("$24.00", { selector: "dd" });
  fireEvent.change(view.getByLabelText("People"), { target: { value: "0" } });
  expect(view.getByRole("alert").textContent).toContain("last valid value");
  expect(view.getByText("$24.00", { selector: "dd" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Reset inputs" }));
  expect(view.getByText("$36.00")).toBeTruthy();
  expect(view.queryByRole("alert")).toBeNull();
  fireEvent.change(view.getByLabelText("Breakdown"), {
    target: { value: "table" },
  });
  expect(view.queryByRole("img")).toBeNull();
  expect(view.getByRole("table")).toBeTruthy();
  view.lifecycle.unmount();
});

it("applies state changed elsewhere and runs agent commands in the copy they target", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const backend = server();
  const view = renderSlot(app.messageDirectives[0]!, props, {
    rpc: backend.rpc,
  });
  await view.findByText("$36.00");
  await waitFor(() =>
    expect(backend.calls.some((c) => c.method === "presence")).toBe(true),
  );
  expect(
    backend.calls.find((c) => c.method === "presence")!.input.actions,
  ).toEqual(["set", "reset"]);
  backend.shared.state = { ...(backend.shared.state as object), people: 6 };
  backend.shared.version = 7;
  await view.behavior.emitRealtime("state", {
    id: answer.id,
    threadId: answer.threadId,
    version: 7,
    by: "agent",
  });
  await view.findByText("$24.00", { selector: "dd" });
  expect(view.getByText("Agent · updated")).toBeTruthy();
  await view.behavior.emitRealtime("command", {
    cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a11",
    id: answer.id,
    threadId: answer.threadId,
    clientId: "someone-else-1234",
    action: "set",
    args: [{ people: 2 }],
  });
  expect(view.getByText("$24.00", { selector: "dd" })).toBeTruthy();
  await view.behavior.emitRealtime("command", {
    cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a12",
    id: answer.id,
    threadId: answer.threadId,
    clientId: backend.clientId(),
    action: "set",
    args: [{ people: 3 }],
  });
  await view.findByText("$48.00", { selector: "dd" });
  expect(view.getByText("Agent · set people 3")).toBeTruthy();
  await waitFor(() =>
    expect(
      backend.calls.find((c) => c.method === "result")?.input,
    ).toMatchObject({ ok: true, value: { inputs: { people: 3 } } }),
  );
  await view.behavior.emitRealtime("command", {
    cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a13",
    id: answer.id,
    threadId: answer.threadId,
    clientId: backend.clientId(),
    action: "set",
    args: [{ guests: 3 }],
  });
  await waitFor(() =>
    expect(
      backend.calls.filter((c) => c.method === "result")[1]?.input,
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unknown control"),
    }),
  );
  view.lifecycle.unmount();
});

it("uses the enclosing message thread for retrieval and recovers from a failed load", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const backend = server();
  let failed = true;
  const view = renderSlot(
    app.messageDirectives[0]!,
    { ...props, attributes: { id: answer.id, thread: "thr_other" } },
    {
      rpc: {
        ...backend.rpc,
        get: (input) => {
          expect(input).toEqual({ id: answer.id, threadId: answer.threadId });
          if (failed) throw new Error("Offline");
          return answer;
        },
      },
    },
  );
  await view.findByText("Offline");
  failed = false;
  fireEvent.click(view.getByRole("button", { name: "Retry" }));
  await view.findByText(bill.title);
  expect(
    view.inspection.rpcCalls.filter((c) => c.method === "get"),
  ).toHaveLength(2);
  view.lifecycle.unmount();
});

it("renders HTML answers in an opaque-origin sandbox, sizes them, and relays state, events, and commands only for their own frame", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const backend = server("html");
  backend.shared.state = { step: 2 };
  backend.shared.version = 3;
  const view = renderSlot(app.messageDirectives[0]!, props, {
    rpc: backend.rpc,
  });
  const frame = (await view.findByTitle(stepper.title)) as HTMLIFrameElement;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("src")).toContain(
    `/api/v1/plugins/bb--interactive-answers/http/frame?thread=thr_test&id=${answer.id}#`,
  );
  expect(
    JSON.parse(decodeURIComponent(frame.getAttribute("src")!.split("#")[1]))
      .state,
  ).toEqual({ step: 2 });
  const send = (
    data: Record<string, unknown>,
    source: MessageEventSource | null = frame.contentWindow,
  ) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { source: "interactive-answer", id: answer.id, ...data },
        source,
      }),
    );
  send({ type: "state", state: { step: 9 } }, window);
  send({ type: "height", height: 512 });
  send({ type: "state", state: { step: 4 } });
  send({ type: "event", name: "step", data: 4 });
  expect(frame.style.height).toBe("512px");
  await waitFor(() => expect(backend.shared.state).toEqual({ step: 4 }));
  expect(backend.calls.find((c) => c.method === "event")?.input).toMatchObject({
    name: "step",
    data: 4,
  });
  for (let i = 0; i < 200; i++) send({ type: "event", name: "spam", data: i });
  await waitFor(() =>
    expect(
      backend.calls.filter((c) => c.method === "event").length,
    ).toBeGreaterThan(30),
  );
  expect(backend.calls.filter((c) => c.method === "event").length).toBeLessThan(
    50,
  );
  send({ type: "actions", actions: ["next"] });
  await waitFor(() =>
    expect(
      backend.calls.filter((c) => c.method === "presence").at(-1)?.input
        .actions,
    ).toEqual(["next"]),
  );
  const posted: unknown[] = [];
  frame.contentWindow!.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as Window["postMessage"];
  await view.behavior.emitRealtime("command", {
    cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a14",
    id: answer.id,
    threadId: answer.threadId,
    clientId: backend.clientId(),
    action: "next",
    args: [],
  });
  const command = posted.find(
    (m) => (m as { type?: string }).type === "command",
  ) as { cmdId: string; action: string };
  expect(command.action).toBe("next");
  send({ type: "result", cmdId: command.cmdId, ok: true, value: { step: 5 } });
  await waitFor(() =>
    expect(
      backend.calls.find((c) => c.method === "result")?.input,
    ).toMatchObject({
      cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a14",
      ok: true,
      value: { step: 5 },
    }),
  );
  await view.behavior.emitRealtime("command", {
    cmdId: "8c1b0c47-7f2a-4a39-9d29-4e7a8a0b9a15",
    id: answer.id,
    threadId: answer.threadId,
    clientId: backend.clientId(),
    action: "play",
    args: [{ bpm: 90, lead: { wave: "saw" } }],
  });
  expect(view.getByText("Agent · play")).toBeTruthy();
  const play = posted.find(
    (m) => (m as { action?: string }).action === "play",
  ) as { cmdId: string };
  send({ type: "result", cmdId: play.cmdId, ok: true, value: null });
  backend.shared.state = { step: 7 };
  backend.shared.version = 50;
  await view.behavior.emitRealtime("state", {
    id: answer.id,
    threadId: answer.threadId,
    version: 50,
    by: "agent",
  });
  await waitFor(() =>
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "state", state: { step: 7 } }),
    ),
  );
  posted.length = 0;
  fireEvent.load(frame);
  expect(posted).toContainEqual(
    expect.objectContaining({ type: "state", state: { step: 7 } }),
  );
  expect(posted).toContainEqual(expect.objectContaining({ type: "theme" }));
  send({ type: "send", label: "Synth take", data: { keys: [["C4", 0, 1]] } });
  expect(backend.calls.some((c) => c.method === "share")).toBe(false);
  Object.defineProperty(navigator, "userActivation", {
    value: { isActive: true },
    configurable: true,
  });
  send({ type: "send", label: "Synth take", data: { keys: [["C4", 0, 1]] } });
  send({ type: "open", url: "https://example.com/" });
  expect(backend.calls.some((c) => c.method === "share")).toBe(false);
  expect(view.inspection.navigateCalls).toEqual([]);
  frame.focus();
  send({ type: "send", label: "Synth take", data: { keys: [["C4", 0, 1]] } });
  send({ type: "open", url: "https://example.com/" });
  await waitFor(() =>
    expect(view.inspection.composer.draft.mentions).toEqual([
      expect.objectContaining({ id: `${answer.id}.12`, label: "Synth take" }),
    ]),
  );
  expect(backend.calls.find((c) => c.method === "share")?.input).toMatchObject({
    label: "Synth take",
    data: { keys: [["C4", 0, 1]] },
  });
  expect(view.inspection.navigateCalls).toEqual([]);
  const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
  frame.focus();
  send({ type: "open", url: "javascript:alert(1)" });
  send({ type: "open", url: "https://example.com/" });
  expect(view.inspection.navigateCalls).toEqual([
    { method: "openUrl", url: "https://example.com/" },
  ]);
  later.mockRestore();
  Object.defineProperty(navigator, "userActivation", {
    value: undefined,
    configurable: true,
  });
  view.lifecycle.unmount();
});

it("keeps a newer remote state when a frame saves the state it booted with", async () => {
  const app = await loadPluginApp(() => import("./app.js"));
  const backend = server("html");
  backend.shared.state = { step: 2 };
  backend.shared.version = 3;
  const view = renderSlot(app.messageDirectives[0]!, props, {
    rpc: backend.rpc,
  });
  const frame = (await view.findByTitle(stepper.title)) as HTMLIFrameElement;
  expect(
    JSON.parse(decodeURIComponent(frame.getAttribute("src")!.split("#")[1]))
      .version,
  ).toBe(3);
  const posted: unknown[] = [];
  frame.contentWindow!.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as Window["postMessage"];
  const send = (data: Record<string, unknown>) =>
    fireEvent(
      window,
      new MessageEvent("message", {
        data: { source: "interactive-answer", id: answer.id, ...data },
        source: frame.contentWindow,
      }),
    );
  backend.shared.state = { step: 6 };
  backend.shared.version = 4;
  await view.behavior.emitRealtime("state", {
    id: answer.id,
    threadId: answer.threadId,
    version: 4,
    by: "agent",
  });
  await waitFor(() =>
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "state",
        state: { step: 6 },
        version: 4,
      }),
    ),
  );
  posted.length = 0;
  send({ type: "state", state: { step: 2 }, base: 3 });
  expect(posted).toContainEqual(
    expect.objectContaining({ type: "state", state: { step: 6 }, version: 4 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(backend.shared.state).toEqual({ step: 6 });
  expect(
    backend.calls.some(
      (c) =>
        c.method === "setState" &&
        JSON.stringify(c.input.state) === JSON.stringify({ step: 2 }),
    ),
  ).toBe(false);
  posted.length = 0;
  fireEvent.load(frame);
  expect(posted).toContainEqual(
    expect.objectContaining({ type: "state", state: { step: 6 }, version: 4 }),
  );
  send({ type: "state", state: { step: 7 }, base: 4 });
  await waitFor(() => expect(backend.shared.state).toEqual({ step: 7 }));
  view.lifecycle.unmount();
});
