import { describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "@bb/domain";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import {
  buildAppCommandActions,
  PALETTE_COMMAND_IDS,
} from "./palette-app-commands";

const SHORTCUT: AppShortcutPresentation = {
  ariaKeyshortcuts: "Meta+Shift+O",
  label: "⌘⇧O",
};

function build(
  available: readonly AppCommandId[],
  shortcuts: ReadonlyMap<AppCommandId, AppShortcutPresentation> = new Map(),
) {
  const dispatch = vi.fn();
  const actions = buildAppCommandActions({
    target: null,
    isCommandAvailable: (command) => available.includes(command),
    dispatch,
    shortcuts,
  });
  return { actions, dispatch };
}

describe("PALETTE_COMMAND_IDS", () => {
  it("omits the numbered accelerator families and the palette's own command", () => {
    expect(PALETTE_COMMAND_IDS).toContain("thread.new");
    expect(PALETTE_COMMAND_IDS).not.toContain("thread.jump.1");
    expect(PALETTE_COMMAND_IDS).not.toContain("pane.focus.1");
    expect(PALETTE_COMMAND_IDS).not.toContain("question.select.1");
    expect(PALETTE_COMMAND_IDS).not.toContain("palette.open");
  });

  it("omits the relative cycle commands but keeps the discrete composer ones", () => {
    expect(PALETTE_COMMAND_IDS).toContain("composer.focus");
    expect(PALETTE_COMMAND_IDS).toContain("modelPicker.toggle");
    for (const cycled of [
      "modelPicker.cycleModel",
      "modelPicker.cycleModelBackward",
      "modelPicker.cycleProvider",
      "modelPicker.cycleProviderBackward",
      "modelPicker.cycleReasoning",
      "modelPicker.cycleReasoningBackward",
    ] as const) {
      expect(PALETTE_COMMAND_IDS).not.toContain(cycled);
    }
  });
});

describe("buildAppCommandActions", () => {
  it("lists only commands that apply right now", () => {
    const { actions } = build(["thread.new", "panel.toggle"]);
    expect(actions.map((action) => action.title)).toEqual([
      "New thread",
      "Toggle panel",
    ]);
  });

  it("never lists a palette-hidden command even when it is available", () => {
    const { actions } = build(["thread.jump.1", "palette.open", "thread.new"]);
    expect(actions.map((action) => action.title)).toEqual(["New thread"]);
  });

  it("carries the group label and the command's current shortcut", () => {
    const { actions } = build(
      ["thread.new"],
      new Map([["thread.new" as AppCommandId, SHORTCUT]]),
    );
    expect(actions[0]).toMatchObject({
      id: "app:thread.new",
      group: "Threads",
      shortcut: SHORTCUT,
    });
  });

  it("leaves the shortcut null for a command the user has not bound", () => {
    const { actions } = build(["thread.rename"]);
    expect(actions[0]?.shortcut).toBeNull();
  });

  it("dispatches with the element that was focused before the palette opened", () => {
    const target = { id: "composer" } as unknown as EventTarget;
    const dispatch = vi.fn();
    const actions = buildAppCommandActions({
      target,
      isCommandAvailable: () => true,
      dispatch,
      shortcuts: new Map(),
    });
    actions.find((action) => action.id === "app:thread.new")?.run();
    expect(dispatch).toHaveBeenCalledWith("thread.new", target);
  });
});
