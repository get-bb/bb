import { describe, expect, it } from "vitest";
import { APP_COMMAND_IDS, appKeyboardShortcutReference } from "../src/index.js";

function row(command: string) {
  const found = appKeyboardShortcutReference()
    .flatMap((group) => group.rows)
    .find((candidate) => candidate.command === command);
  if (!found) throw new Error(`${command} is missing from the reference`);
  return found;
}

describe("appKeyboardShortcutReference", () => {
  it("lists every app command exactly once", () => {
    const commands = appKeyboardShortcutReference().flatMap((group) =>
      group.rows.map((candidate) => candidate.command),
    );
    expect([...commands].sort()).toEqual([...APP_COMMAND_IDS].sort());
  });

  it("joins default keys per platform and surface", () => {
    expect(row("thread.new").mac).toEqual([
      { keys: "⇧ ⌘ O", surface: "everywhere" },
      { keys: "⌘ N", surface: "desktop app" },
    ]);
    expect(row("thread.new").windowsLinux).toEqual([
      { keys: "Ctrl + Shift + O", surface: "everywhere" },
      { keys: "Ctrl + N", surface: "desktop app" },
    ]);
  });

  it("keeps Mac-only arrow bindings off Windows and Linux", () => {
    const paneLeft = row("pane.focus.left");
    expect(paneLeft.mac.length).toBeGreaterThan(0);
    expect(paneLeft.windowsLinux).toEqual([]);
  });

  it("leaves unassigned commands without keys", () => {
    expect(row("thread.rename")).toMatchObject({ mac: [], windowsLinux: [] });
  });
});
