import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startToolchainWatch, type ToolchainWatch } from "./toolchain-watch.js";

const roots: string[] = [];
const watches: ToolchainWatch[] = [];

function tempDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "bb-toolchain-watch-"));
  roots.push(directory);
  return directory;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

async function watchPath(readSearchPath: () => string) {
  const onChange = vi.fn();
  const watch = startToolchainWatch({
    readSearchPath,
    onChange,
    onWatchError: (directory, error) => {
      throw new Error(`watch failed for ${directory}: ${String(error)}`);
    },
    setTimeoutFn: (callback) => setTimeout(callback, 50),
  });
  watches.push(watch);
  await settle();
  onChange.mockClear();
  return onChange;
}

afterEach(() => {
  for (const watch of watches.splice(0)) watch.stop();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("toolchain watch", () => {
  it("reports one change when a CLI appears in a search-path directory", async () => {
    const bin = tempDir();
    const target = path.join(tempDir(), "codex");
    writeFileSync(target, "#!/bin/sh\n");
    const onChange = await watchPath(() =>
      [bin, path.join(bin, "missing")].join(path.delimiter),
    );

    symlinkSync(target, path.join(bin, "codex"));
    writeFileSync(path.join(bin, "codex-helper"), "");

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("follows the search path when it changes", async () => {
    const first = tempDir();
    const second = tempDir();
    let searchPath = first;
    const onChange = await watchPath(() => searchPath);

    searchPath = second;
    watches.at(-1)?.resync();
    writeFileSync(path.join(first, "old"), "");
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    writeFileSync(path.join(second, "new"), "");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
});
