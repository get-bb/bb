// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { evictTerminalRuntime } from "./terminal-runtime-cache";
import { ThreadTerminalView } from "./ThreadTerminalView";

const state = vi.hoisted(() => ({
  transports: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    onMessage: (message: unknown) => void;
    setVisible: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { terminalCopyOnSelect: false } },
  }),
}));

vi.mock("@xterm/addon-webgl", () => {
  throw new Error("WebGL unavailable");
});

vi.mock("@bb/client-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/client-core")>()),
  TerminalWebSocketTransport: class {
    dispose = vi.fn();
    setVisible = vi.fn();
    onMessage: (message: unknown) => void;
    constructor(options: { onMessage: (message: unknown) => void }) {
      this.onMessage = options.onMessage;
      state.transports.push(this);
    }
    acknowledgeOutput() {}
    sendInput() {}
    sendResize() {}
    start() {}
  },
}));

const session = makeTerminalSession({ status: "running" });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  evictTerminalRuntime(session.id);
  vi.restoreAllMocks();
  state.transports = [];
});

function renderTerminal(keepAlive: boolean) {
  return render(
    <ThreadTerminalView
      autoFocus={false}
      isPanelOpen
      keepAlive={keepAlive}
      session={session}
    />,
  );
}

async function mountTerminal(keepAlive: boolean) {
  const view = renderTerminal(keepAlive);
  const xterm = await waitFor(() => {
    const element = view.container.querySelector(".xterm");
    expect(element).not.toBeNull();
    return element!;
  });
  return { view, xterm };
}

it("reuses the parked terminal and socket when the same session remounts", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  first.view.unmount();
  expect(transport.setVisible).toHaveBeenLastCalledWith(false);
  expect(transport.dispose).not.toHaveBeenCalled();
  const second = renderTerminal(true);
  expect(second.container.querySelector(".xterm")).toBe(first.xterm);
  expect(state.transports).toHaveLength(1);
  expect(transport.setVisible).toHaveBeenLastCalledWith(true);
  expect(transport.dispose).not.toHaveBeenCalled();
});

it("disposes a parked terminal that exits and creates a new one on return", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  first.view.unmount();
  act(() => {
    transport.onMessage({
      type: "exited",
      session: { ...session, status: "exited", exitCode: 0 },
    });
  });
  expect(transport.dispose).toHaveBeenCalledTimes(1);
  await mountTerminal(true);
  expect(state.transports).toHaveLength(2);
});

it("disposes the terminal on unmount without keepAlive", async () => {
  const first = await mountTerminal(false);
  first.view.unmount();
  expect(state.transports[0]!.dispose).toHaveBeenCalledTimes(1);
  await mountTerminal(true);
  expect(state.transports).toHaveLength(2);
});

it("never parks a terminal unmounted before its async mount finishes", async () => {
  renderTerminal(true).unmount();
  await mountTerminal(true);
  expect(state.transports).toHaveLength(1);
  expect(state.transports[0]!.dispose).not.toHaveBeenCalled();
});
