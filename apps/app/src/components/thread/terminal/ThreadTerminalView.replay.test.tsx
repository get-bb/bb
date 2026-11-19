// @vitest-environment jsdom

import type { TerminalServerMessage } from "@bb/server-contract";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { settleLazyModules } from "@/test/lazy-modules";
import { ThreadTerminalView } from "./ThreadTerminalView";

const transport = vi.hoisted(() => ({
  acknowledged: vi.fn(),
  input: vi.fn(),
  onMessage: null as ((message: TerminalServerMessage) => void) | null,
  onSequenceGap: null as
    | ((expectedSeq: number, receivedSeq: number) => void)
    | null,
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
    constructor(options: {
      onMessage: (message: TerminalServerMessage) => void;
      onSequenceGap: (expectedSeq: number, receivedSeq: number) => void;
    }) {
      transport.onMessage = options.onMessage;
      transport.onSequenceGap = options.onSequenceGap;
    }
    acknowledgeOutput = transport.acknowledged;
    sendInput = transport.input;
    sendResize() {}
    setVisible() {}
    start() {}
    dispose() {}
  },
}));

const session = makeTerminalSession({ status: "running" });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  transport.acknowledged.mockReset();
  transport.input.mockReset();
  transport.onMessage = null;
  transport.onSequenceGap = null;
});

async function mountTerminal(): Promise<Terminal> {
  const open = Terminal.prototype.open;
  const opened = new Promise<Terminal>((resolve) => {
    vi.spyOn(Terminal.prototype, "open").mockImplementation(function (
      this: Terminal,
      parent: HTMLElement,
    ) {
      open.call(this, parent);
      resolve(this);
    });
  });
  render(
    <ThreadTerminalView autoFocus={false} isPanelOpen session={session} />,
  );
  const terminal = await settleLazyModules(opened);
  await waitFor(() => expect(transport.onMessage).not.toBeNull());
  return terminal;
}

async function receive(message: TerminalServerMessage): Promise<void> {
  await act(async () => {
    transport.onMessage?.(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function attached(
  replayStartSeq: number,
  nextSeq: number,
): TerminalServerMessage {
  return { type: "attached", session, replayStartSeq, nextSeq };
}

function output(seq: number, text: string): TerminalServerMessage {
  return { type: "output", chunk: { seq, dataBase64: btoa(text) } };
}

function screenLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

it("hides replay until its last chunk has rendered", async () => {
  const terminal = await mountTerminal();

  await receive(attached(0, 3));
  await receive(output(0, "one\r\n"));
  expect(
    terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
      .visibility,
  ).toBe("hidden");
  act(() => terminal.input("during", true));
  expect(transport.input).toHaveBeenLastCalledWith(btoa("during"));
  transport.input.mockClear();
  act(() => {
    transport.onMessage?.(
      output(
        1,
        "two\u001b[6n\u001b[c\u001b[>c\u001b[>q\u001b[?25$p\u001b[?u\u001b]10;?\u0007\u001bP$qm\u001b\\\r\n",
      ),
    );
    terminal.input("queued", true);
  });
  expect(transport.input).toHaveBeenLastCalledWith(btoa("queued"));
  transport.input.mockClear();
  expect(
    terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
      .visibility,
  ).toBe("hidden");
  await receive(output(2, "three\r\n"));

  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(3));
  await waitFor(() =>
    expect(
      terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
        .visibility,
    ).toBe(""),
  );
  expect(screenLines(terminal)).toEqual(["one", "two", "three"]);
  expect(transport.input).not.toHaveBeenCalled();

  await receive(output(3, "live\r\n"));
  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(4));
  expect(screenLines(terminal)).toEqual(["one", "two", "three", "live"]);
  await receive(output(4, "\u001b[6n"));
  expect(atob(transport.input.mock.calls.at(-1)?.[0])).toMatch(
    /^\u001b\[\d+;\d+R$/,
  );
  act(() => terminal.input("after", true));
  expect(transport.input).toHaveBeenLastCalledWith(btoa("after"));
});

it("hides the screen until the replay after a sequence gap is complete", async () => {
  const terminal = await mountTerminal();
  await receive(attached(0, 0));
  await receive(output(0, "old screen\r\n"));
  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(1));

  act(() => transport.onSequenceGap?.(1, 5));
  await receive(attached(5, 7));
  expect(
    terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
      .visibility,
  ).toBe("hidden");
  await receive(output(5, "five\r\n"));
  expect(
    terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
      .visibility,
  ).toBe("hidden");
  await receive(output(6, "six\r\n"));

  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(7));
  await waitFor(() =>
    expect(
      terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
        .visibility,
    ).toBe(""),
  );
  expect(screenLines(terminal)).toEqual([
    "",
    "Some terminal output was unavailable after reconnect",
    "five",
    "six",
  ]);
});

it("keeps the received part of a replay when the socket reattaches before it ends", async () => {
  const terminal = await mountTerminal();

  await receive(attached(0, 4));
  await receive(output(0, "a\r\n"));
  await receive(output(1, "b\r\n"));
  await receive(attached(2, 4));
  await receive(output(2, "c\r\n"));
  await receive(output(3, "d\r\n"));

  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(4));
  await waitFor(() =>
    expect(
      terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
        .visibility,
    ).toBe(""),
  );
  expect(screenLines(terminal)).toEqual(["a", "b", "c", "d"]);
});

it("writes the received part of a replay before a later error", async () => {
  const terminal = await mountTerminal();

  await receive(attached(0, 3));
  await receive(output(0, "a\r\n"));
  await receive({
    type: "error",
    code: "terminal_not_found",
    message: "Terminal session not found",
  });

  await waitFor(() => expect(transport.acknowledged).toHaveBeenCalledWith(1));
  await waitFor(() =>
    expect(
      terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style
        .visibility,
    ).toBe(""),
  );
  expect(screenLines(terminal)).toEqual([
    "a",
    "",
    "Terminal error: Terminal session not found",
  ]);
});
