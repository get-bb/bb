import { describe, expect, it } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import {
  resolveTerminalPanelMount,
  selectActiveTerminalSession,
} from "./useThreadTerminalController";

type PanelStep = { isPanelOpen: boolean; isPanelPersistedOpen: boolean };

function runPanelSteps(initiallyOpen: boolean, steps: readonly PanelStep[]) {
  let hasPanelOpened = initiallyOpen;
  return steps.map((step) => {
    const mount = resolveTerminalPanelMount({ hasPanelOpened, ...step });
    hasPanelOpened = mount.hasPanelOpened;
    return mount.shouldMountTerminalView;
  });
}

describe("resolveTerminalPanelMount", () => {
  it("does not mount or fetch a persisted-open terminal the panel never showed", () => {
    expect(
      resolveTerminalPanelMount({
        hasPanelOpened: false,
        isPanelOpen: false,
        isPanelPersistedOpen: true,
      }),
    ).toEqual({
      hasPanelOpened: false,
      shouldFetchTerminals: false,
      shouldMountTerminalView: false,
    });
  });

  it("mounts and fetches for an open panel that is not persisted open", () => {
    expect(
      resolveTerminalPanelMount({
        hasPanelOpened: false,
        isPanelOpen: true,
        isPanelPersistedOpen: false,
      }),
    ).toEqual({
      hasPanelOpened: true,
      shouldFetchTerminals: true,
      shouldMountTerminalView: true,
    });
  });

  it("keeps the view mounted across a compact close and unmounts once persisted state closes", () => {
    expect(
      runPanelSteps(true, [
        { isPanelOpen: true, isPanelPersistedOpen: true },
        { isPanelOpen: false, isPanelPersistedOpen: true },
        { isPanelOpen: false, isPanelPersistedOpen: false },
        { isPanelOpen: false, isPanelPersistedOpen: true },
        { isPanelOpen: true, isPanelPersistedOpen: true },
      ]),
    ).toEqual([true, true, false, false, true]);
  });
});

describe("selectActiveTerminalSession", () => {
  const own = makeTerminalSession({ id: "term_1", threadId: "thr_1" });
  const sibling = makeTerminalSession({
    id: "term_sibling",
    threadId: "thr_1",
  });
  const target = { kind: "thread", threadId: "thr_1" } as const;

  it("selects the panel's own terminal", () => {
    expect(
      selectActiveTerminalSession({
        sessions: [sibling, own],
        target,
        terminalId: "term_1",
      }),
    ).toBe(own);
  });

  it("never shows a sibling terminal in place of its own missing terminal", () => {
    expect(
      selectActiveTerminalSession({
        sessions: [sibling],
        target,
        terminalId: "term_1",
      }),
    ).toBeNull();
  });
});
