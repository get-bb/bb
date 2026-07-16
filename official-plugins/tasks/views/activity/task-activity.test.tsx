// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayComment } from "../../shared/contract.js";
import {
  AgentNotificationControl,
  agentNotificationTarget,
} from "./task-activity.js";

afterEach(cleanup);

function comment(
  kind: DisplayComment["kind"],
  threadId: string | null = null,
  threadTitle: string | null = null,
): DisplayComment {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZ${kind === "agent" ? "A" : "U"}`,
    taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    kind,
    authorName: kind === "agent" ? "Agent" : "You",
    presetName: null,
    threadId,
    threadTitle,
    body: "Reply",
    notifiedCount: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

describe("agent notification target", () => {
  it("uses the last agent reply rather than the last activity entry", () => {
    expect(
      agentNotificationTarget([
        comment("agent", "thr_first", "First agent"),
        comment("agent", "thr_latest", "Latest agent"),
        comment("user"),
      ]),
    ).toEqual({ kind: "ready", title: "Latest agent" });
  });

  it("distinguishes no prior reply from an unavailable latest responder", () => {
    expect(agentNotificationTarget([comment("user")])).toEqual({
      kind: "none",
    });
    expect(
      agentNotificationTarget([comment("agent", "thr_private", null)]),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("AgentNotificationControl", () => {
  it("exposes an enabled accessible opt-in for the latest responder", () => {
    const onCheckedChange = vi.fn();
    render(
      <AgentNotificationControl
        target={{ kind: "ready", title: "Fix the login bug" }}
        checked
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch", {
      name: "Notify last responding agent",
    });
    expect(toggle.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Notify Fix the login bug")).toBeTruthy();
    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("clearly disables notification when no agent has replied", () => {
    render(
      <AgentNotificationControl
        target={{ kind: "none" }}
        checked
        onCheckedChange={vi.fn()}
      />,
    );

    expect(screen.getByText("No prior agent reply to notify")).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Notify last responding agent" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("does not expose a private or missing latest thread as a target", () => {
    render(
      <AgentNotificationControl
        target={{ kind: "unavailable" }}
        checked
        onCheckedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Latest responding agent can’t be notified"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Notify last responding agent" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
