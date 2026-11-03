// @vitest-environment jsdom

import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal, type ILink } from "@xterm/xterm";
import { afterEach, expect, it, vi } from "vitest";
import {
  createTerminalFileLinkProvider,
  parseTerminalReportedCwd,
} from "./terminal-file-links";

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

async function linksFor(text: string, cols = 80, cwd = "/repo/src") {
  const terminal = new Terminal({ cols, rows: 5, allowProposedApi: true });
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  disposers.push(() => terminal.dispose());
  await new Promise<void>((resolve) => terminal.write(text, resolve));
  const openFile = vi.fn();
  const provider = createTerminalFileLinkProvider({
    terminal,
    hostId: "host_remote",
    getCwd: () => cwd,
    openFile,
  });
  const links = (line: number) =>
    new Promise<ILink[]>((resolve) =>
      provider.provideLinks(line, (value) => resolve(value ?? [])),
    );
  return { links, openFile };
}

it.each([
  ["src/main.ts", "/repo/src/src/main.ts", null],
  [
    "./main.ts:12",
    "/repo/src/main.ts",
    { kind: "line", line: 12, column: null },
  ],
  ["../test.ts:12:3:", "/repo/test.ts", { kind: "line", line: 12, column: 3 }],
  ["(/tmp/test.ts:8:2)", "/tmp/test.ts", { kind: "line", line: 8, column: 2 }],
  [
    '"/tmp/my file.ts":8:2',
    "/tmp/my file.ts",
    { kind: "line", line: 8, column: 2 },
  ],
  [
    "C:\\src\\main.ts:4:9",
    "C:\\src\\main.ts",
    { kind: "line", line: 4, column: 9 },
  ],
])("opens %s on the terminal host", async (text, path, location) => {
  const { links, openFile } = await linksFor(text);
  const detected = await links(1);
  expect(detected).toHaveLength(1);
  detected[0]!.activate(new MouseEvent("click"), detected[0]!.text);
  expect(openFile).not.toHaveBeenCalled();
  detected[0]!.activate(
    new MouseEvent("click", { ctrlKey: true }),
    detected[0]!.text,
  );
  expect(openFile).toHaveBeenCalledExactlyOnceWith({
    target: { kind: "host", hostId: "host_remote", path },
    location,
  });
});

it("maps wrapped links after wide and surrogate characters to terminal cells", async () => {
  const { links } = await linksFor("界😀 /long/path/main.ts:12:3", 16);
  const first = (await links(1))[0]!;
  const second = (await links(2))[0]!;
  expect(first.range).toEqual({ start: { x: 6, y: 1 }, end: { x: 12, y: 2 } });
  expect(second.range).toEqual(first.range);
  expect(first.text).toBe("/long/path/main.ts:12:3");
});

it("does not reinterpret URLs, prose, or unsupported schemes as files", async () => {
  const { links } = await linksFor(
    "https://example.com/a.ts file:///tmp/a.ts hello node:internal/fs /tmp/test.ts:0 /tmp/test.ts:1:0 /tmp/test.ts:99999999999999999",
  );
  expect(await links(1)).toEqual([]);
});

it.each([
  ["file://mac.local/Users/me/my%20repo", "/Users/me/my repo"],
  ["file:///C:/src/app", "C:/src/app"],
  ["file://host/%E0%A4%A", null],
  ["https://example.com/repo", null],
  ["not a url", null],
])("reads the shell working directory from OSC 7 %s", (data, cwd) => {
  expect(parseTerminalReportedCwd(data)).toBe(cwd);
});
