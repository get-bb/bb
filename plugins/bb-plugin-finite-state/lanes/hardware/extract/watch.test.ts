import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HardwareSourceWatcher, refuseAutomaticExtraction } from "./watch.js";

describe("hardware source watch", () => {
  it("survives repeated rename-over-save events and only requests a source refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-hw-watch-"));
    const schematic = join(root, "board.kicad_sch");
    await writeFile(schematic, "before");
    const onChange = vi.fn();
    const onError = vi.fn();
    const watcher = new HardwareSourceWatcher({
      schematicPath: schematic,
      boardPath: null,
      onChange,
      onError,
      debounceMs: 10,
    });
    watcher.start();

    for (const content of ["first save", "second save"]) {
      const replacement = join(root, `replacement-${content.replace(" ", "-")}`);
      await writeFile(replacement, content);
      await rename(replacement, schematic);
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(content === "first save" ? 1 : 2));
    }

    watcher.stop();
    expect(onError).not.toHaveBeenCalled();
    expect(onChange.mock.calls).toEqual([["schematic"], ["schematic"]]);
  });

  it("refuses every automatic regeneration path, including active agent runs", () => {
    expect(() => refuseAutomaticExtraction(false)).toThrow("explicit extraction request");
    expect(() => refuseAutomaticExtraction(true)).toThrow("during an agent run");
  });
});
