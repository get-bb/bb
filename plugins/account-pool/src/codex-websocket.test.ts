import { describe, expect, it, vi } from "vitest";
import type { ExperimentalPluginWebSocket } from "@get-bb/plugin-sdk";
import { createCodexWebSocketHandlers } from "./codex-websocket.js";
import type { AccountPoolHub } from "./hub.js";

function sse(events: ReadonlyArray<Record<string, unknown>>): string {
  return `${events
    .map(
      (event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}`,
    )
    .join("\n\n")}\n\ndata: [DONE]\n\n`;
}

function createFixture(upstreamBodies: string[]) {
  const forwarded: unknown[] = [];
  const hub = {
    authenticate: async () => "host-one",
    handleAuthenticated: async (request: Request) => {
      forwarded.push(await request.json());
      const body = upstreamBodies.shift();
      if (body === undefined) throw new Error("No upstream body queued.");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  };
  const sent: string[] = [];
  const socket: ExperimentalPluginWebSocket = {
    readyState: 1,
    send(data) {
      sent.push(String(data));
    },
    close: vi.fn(),
  };
  const request = new Request("http://account-pool/v1/responses");
  const handlers = createCodexWebSocketHandlers(
    { request, url: new URL(request.url), headers: new Headers() },
    hub as unknown as AccountPoolHub,
    { debug: () => undefined },
  );
  return { handlers, socket, sent, forwarded };
}

async function frame(
  fixture: ReturnType<typeof createFixture>,
  payload: Record<string, unknown>,
  expectedSent: number,
): Promise<void> {
  await fixture.handlers.onMessage?.(
    fixture.socket,
    JSON.stringify({ type: "response.create", ...payload }),
  );
  await vi.waitFor(() => expect(fixture.sent).toHaveLength(expectedSent));
}

describe("createCodexWebSocketHandlers", () => {
  it("replays streamed output items when response.completed omits them", async () => {
    const message = { type: "message", id: "msg-1", role: "assistant" };
    const toolCall = { type: "custom_tool_call", call_id: "call-1" };
    const fixture = createFixture([
      sse([
        { type: "response.created", response: { id: "resp-1" } },
        { type: "response.output_item.done", item: message },
        { type: "response.output_item.done", item: toolCall },
        { type: "response.completed", response: { id: "resp-1", output: [] } },
      ]),
      sse([
        { type: "response.created", response: { id: "resp-2" } },
        { type: "response.completed", response: { id: "resp-2", output: [] } },
      ]),
    ]);
    await fixture.handlers.onOpen?.(fixture.socket);
    await frame(fixture, { input: [{ type: "message", id: "user-1" }] }, 4);
    const toolOutput = { type: "custom_tool_call_output", call_id: "call-1" };
    await frame(
      fixture,
      { previous_response_id: "resp-1", input: [toolOutput] },
      6,
    );
    expect(fixture.forwarded[1]).toMatchObject({
      input: [{ type: "message", id: "user-1" }, message, toolCall, toolOutput],
    });
  });

  it("keeps the previous answer across turns after a full request", async () => {
    const answer = { type: "message", id: "msg-1", role: "assistant" };
    const fixture = createFixture([
      sse([
        { type: "response.output_item.done", item: answer },
        { type: "response.completed", response: { id: "resp-1", output: [] } },
      ]),
      sse([
        { type: "response.completed", response: { id: "resp-2", output: [] } },
      ]),
    ]);
    await fixture.handlers.onOpen?.(fixture.socket);
    await frame(fixture, { input: [{ type: "message", id: "question-1" }] }, 2);
    await frame(
      fixture,
      {
        previous_response_id: "resp-1",
        input: [{ type: "message", id: "question-2" }],
      },
      3,
    );
    expect(fixture.forwarded[1]).toMatchObject({
      input: [
        { type: "message", id: "question-1" },
        answer,
        { type: "message", id: "question-2" },
      ],
    });
  });

  it("falls back to the completed output when no items were streamed", async () => {
    const answer = { type: "message", id: "msg-1", role: "assistant" };
    const fixture = createFixture([
      sse([
        {
          type: "response.completed",
          response: { id: "resp-1", output: [answer] },
        },
      ]),
      sse([
        { type: "response.completed", response: { id: "resp-2", output: [] } },
      ]),
    ]);
    await fixture.handlers.onOpen?.(fixture.socket);
    await frame(fixture, { input: [{ type: "message", id: "question-1" }] }, 1);
    await frame(
      fixture,
      {
        previous_response_id: "resp-1",
        input: [{ type: "message", id: "question-2" }],
      },
      2,
    );
    expect(fixture.forwarded[1]).toMatchObject({
      input: [
        { type: "message", id: "question-1" },
        answer,
        { type: "message", id: "question-2" },
      ],
    });
  });
});
