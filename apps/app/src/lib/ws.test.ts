// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeReconnectingWebSocket,
  resetFakeReconnectingWebSockets,
} from "@/test/fake-reconnecting-websocket";
import { parseSubKey, WebSocketManager } from "./ws";

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

afterEach(() => {
  resetFakeReconnectingWebSockets();
});

describe("parseSubKey", () => {
  it("parses supported subscription keys with and without ids", () => {
    expect(parseSubKey("thread")).toEqual({ entity: "thread" });
    expect(parseSubKey("system")).toEqual({ entity: "system" });
    expect(parseSubKey("thread:t-1")).toEqual({ entity: "thread", id: "t-1" });
    expect(parseSubKey("project:p-1")).toEqual({
      entity: "project",
      id: "p-1",
    });
    expect(parseSubKey("environment:e-1")).toEqual({
      entity: "environment",
      id: "e-1",
    });
  });

  it("rejects unknown entities", () => {
    expect(parseSubKey("unknown")).toBeNull();
    expect(parseSubKey("bogus:id-1")).toBeNull();
  });
});

describe("WebSocketManager subscriptions", () => {
  function connectManager() {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = FakeReconnectingWebSocket.latest();
    socket.open();
    return { manager, socket };
  }

  it("refcounts a shared key so one unsubscriber does not drop the other", () => {
    const { manager, socket } = connectManager();

    // Two independent surfaces (e.g. the sidebar Workflows section and the
    // project Workflows tab) subscribe to the same entity-wide key.
    manager.subscribe("workflow-run");
    manager.subscribe("workflow-run");
    manager.unsubscribe("workflow-run");

    expect(socket.sentMessages).toEqual([
      JSON.stringify({ type: "subscribe", entity: "workflow-run" }),
    ]);

    manager.unsubscribe("workflow-run");

    expect(socket.sentMessages).toEqual([
      JSON.stringify({ type: "subscribe", entity: "workflow-run" }),
      JSON.stringify({ type: "unsubscribe", entity: "workflow-run" }),
    ]);
  });

  it("replays one subscribe per live key on reconnect", () => {
    const { manager, socket } = connectManager();

    manager.subscribe("workflow-run");
    manager.subscribe("workflow-run");
    manager.subscribe("thread", "t-1");
    socket.sentMessages.length = 0;

    socket.open();

    expect(socket.sentMessages).toEqual([
      JSON.stringify({ type: "subscribe", entity: "workflow-run" }),
      JSON.stringify({ type: "subscribe", entity: "thread", id: "t-1" }),
    ]);
  });
});
