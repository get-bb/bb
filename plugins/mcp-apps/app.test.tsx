// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

afterEach(() => cleanup());

describe("MCP App panel entry", () => {
  it("opens a declared app in the thread side panel", async () => {
    const app = await loadPluginApp(() => import("./app.js"));
    expect(app.threadPanelActions.map((action) => action.id)).toContain("app");
    const slot = renderSlot(app.messageDirectives[0]!, {
      attributes: { session: "123e4567-e89b-12d3-a456-426614174000" },
      source: '::mcp-app{session="123e4567-e89b-12d3-a456-426614174000"}',
      message: { id: "msg-1", threadId: "thread-1", turnId: "turn-1", projectId: "project-1" },
      openWorkspaceFile: null,
    });
    fireEvent.click(slot.getByRole("button", { name: /Open MCP App/ }));
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "app",
        title: "MCP App",
        params: { session: "123e4567-e89b-12d3-a456-426614174000" },
      },
    });
  });
});
