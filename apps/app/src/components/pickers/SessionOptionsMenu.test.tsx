// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadTimelineSessionOption } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SessionOptionsMenu,
  buildSessionOptionMenuSections,
  sessionOptionsTriggerLabel,
} from "./SessionOptionsMenu";

const mode: ThreadTimelineSessionOption = {
  type: "select",
  id: "mode",
  label: "Mode",
  description: "How the agent works",
  category: "mode",
  value: "agent",
  pendingValue: null,
  values: [
    { id: "agent", label: "Agent", description: null, group: null },
    { id: "plan", label: "Plan", description: "Read only", group: null },
  ],
};
const web: ThreadTimelineSessionOption = {
  type: "boolean",
  id: "web",
  label: "Web search",
  description: null,
  category: null,
  value: false,
  pendingValue: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("session option menu sections", () => {
  it("shows the local choice first, then the server's pending value, then the agent's value", () => {
    const pendingMode = { ...mode, pendingValue: "plan" };
    expect(
      buildSessionOptionMenuSections([mode], {}).map((section) => [
        section.selectedLabel,
        section.appliesOnNextTurn,
      ]),
    ).toEqual([["Agent", false]]);
    expect(
      buildSessionOptionMenuSections([pendingMode], {}).map((section) => [
        section.selectedLabel,
        section.appliesOnNextTurn,
      ]),
    ).toEqual([["Plan", true]]);
    expect(
      buildSessionOptionMenuSections([pendingMode], { mode: "agent" }).map(
        (section) => [section.selectedLabel, section.appliesOnNextTurn],
      ),
    ).toEqual([["Agent", false]]);
  });

  it("names the trigger after the agent's mode, a lone option, or nothing in particular", () => {
    const label = (options: ThreadTimelineSessionOption[]) =>
      sessionOptionsTriggerLabel(buildSessionOptionMenuSections(options, {}));
    expect(label([web, mode])).toBe("Agent");
    expect(label([web])).toBe("Web search: Off");
    expect(label([web, { ...web, id: "brave", label: "Brave" }])).toBe(
      "Options",
    );
  });
});

describe("SessionOptionsMenu", () => {
  it("renders nothing when the agent reports no options", () => {
    const { container } = render(
      <SessionOptionsMenu options={[]} choices={{}} onChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("reports a select choice by value id and a boolean choice as a boolean", async () => {
    const onChange = vi.fn();
    render(
      <SessionOptionsMenu
        options={[mode, web]}
        choices={{}}
        onChange={onChange}
      />,
    );
    const open = () =>
      fireEvent.keyDown(screen.getByRole("button", { name: "Agent options" }), {
        key: "Enter",
      });

    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Plan/ }));
    expect(onChange).toHaveBeenLastCalledWith("mode", "plan");

    open();
    fireEvent.click(await screen.findByRole("menuitem", { name: "On" }));
    expect(onChange).toHaveBeenLastCalledWith("web", true);
  });
});
