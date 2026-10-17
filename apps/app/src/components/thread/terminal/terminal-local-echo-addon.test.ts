// @vitest-environment jsdom

import { Terminal } from "@xterm/xterm";
import { expect, it } from "vitest";
import { TerminalLocalEchoAddon } from "./terminal-local-echo-addon";

const bytes = (text: string) => new TextEncoder().encode(text);

function parsed(terminal: Terminal): Promise<void> {
  return new Promise((resolve) => terminal.write("", resolve));
}

async function receive(
  terminal: Terminal,
  addon: TerminalLocalEchoAddon,
  text: string,
): Promise<Uint8Array> {
  const output = addon.reconcile(bytes(text));
  await new Promise<void>((resolve) => {
    terminal.write(output, resolve);
  });
  await parsed(terminal);
  return output;
}

it("leaves the first key tentative, then styles, confirms, and rolls back later keys", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  terminal.write("P");
  await parsed(terminal);
  const line = terminal.buffer.active.getLine(0);
  addon.onUserInput("a");
  await parsed(terminal);
  expect(line?.getCell(1)?.getChars()).toBe("");
  expect([...(await receive(terminal, addon, "a"))]).toEqual([...bytes("a")]);
  expect(line?.getCell(1)?.getChars()).toBe("a");
  addon.onUserInput("b");
  await parsed(terminal);
  expect(line?.getCell(2)?.getChars()).toBe("b");
  expect(line?.getCell(2)?.isUnderline()).toBeTruthy();
  expect(line?.getCell(2)?.isDim()).toBeTruthy();
  await receive(terminal, addon, "b");
  expect(line?.getCell(2)?.isUnderline()).toBeFalsy();
  addon.onUserInput("c");
  await parsed(terminal);
  expect(line?.getCell(3)?.getChars()).toBe("c");
  expect([...(await receive(terminal, addon, "x"))]).toEqual([...bytes("x")]);
  expect(line?.getCell(3)?.getChars()).toBe("x");
  terminal.dispose();
});

it("does not draw typed characters at an echo-off password prompt", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  addon.onUserInput("p");
  await receive(terminal, addon, "p");
  await receive(terminal, addon, "Password:");
  for (const character of "secret") addon.onUserInput(character);
  await parsed(terminal);
  const line = terminal.buffer.active.getLine(0);
  expect(line?.translateToString(true)).toBe("pPassword:");
  addon.onUserInput("\r");
  await parsed(terminal);
  expect(line?.translateToString(true)).toBe("pPassword:");
  terminal.dispose();
});

it("writes tentative echoes before confirming a later displayed key in one chunk", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  addon.onUserInput("a");
  addon.onUserInput("b");
  await receive(terminal, addon, "a");
  addon.onUserInput("c");
  await parsed(terminal);
  expect(terminal.buffer.active.getLine(0)?.getCell(2)?.getChars()).toBe("c");
  expect((await receive(terminal, addon, "bc"))[0]).toBe(bytes("b")[0]);
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
    "abc",
  );
  expect(terminal.buffer.active.cursorX).toBe(3);
  terminal.dispose();
});

it("keeps later unpredicted echo after confirming a displayed cell in one chunk", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 4, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  addon.onUserInput("p");
  await receive(terminal, addon, "p");
  addon.onUserInput("q");
  await parsed(terminal);
  await receive(terminal, addon, "q");
  addon.onUserInput("a");
  addon.onUserInput("b");
  await parsed(terminal);
  await receive(terminal, addon, "ab");
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
    "pqab",
  );
  terminal.dispose();
});

it("keeps later mismatch output after confirming a displayed cell in one chunk", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  addon.onUserInput("p");
  await receive(terminal, addon, "p");
  addon.onUserInput("x");
  addon.onUserInput("y");
  await parsed(terminal);
  await receive(terminal, addon, "xq");
  expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
    "pxq",
  );
  terminal.dispose();
});

it("keeps a wide UTF-8 letter and the next displayed cell separate", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  const addon = new TerminalLocalEchoAddon(terminal);
  addon.setEnabled(true);
  addon.setRoundTripMs(80);
  addon.onUserInput("p");
  await receive(terminal, addon, "p");
  addon.onUserInput("界");
  addon.onUserInput("a");
  await parsed(terminal);
  const line = terminal.buffer.active.getLine(0);
  expect(line?.getCell(1)?.getChars()).toBe("界");
  expect(line?.getCell(1)?.getWidth()).toBe(2);
  expect(line?.getCell(3)?.getChars()).toBe("a");
  await receive(terminal, addon, "界a");
  expect(terminal.buffer.active.cursorX).toBe(4);
  terminal.dispose();
});
