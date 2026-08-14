import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HardwareSourceWatcher, refuseAutomaticExtraction } from "./watch.js";

/** Wait until `getCount()` is unchanged for `quietMs` (debounce settle), with a deadline. */
async function waitForQuiet(
  getCount: () => number,
  quietMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = getCount();
  let lastChangeAt = Date.now();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const next = getCount();
    if (next !== last) {
      last = next;
      lastChangeAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangeAt >= quietMs) return;
  }
  throw new Error(
    `timed out waiting for call count to stay quiet for ${quietMs}ms`,
  );
}

describe("hardware source watch", () => {
  it("survives repeated rename-over-save events and only requests a source refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-hw-watch-"));
    const schematic = join(root, "board.kicad_sch");
    await writeFile(schematic, "before");
    const onChange = vi.fn();
    const onError = vi.fn();
    // Match production default so FSEvents multi-delivery (~50ms apart on Darwin)
    // coalesces instead of splitting into exact-count flakes under load.
    const debounceMs = 100;
    const watcher = new HardwareSourceWatcher({
      schematicPath: schematic,
      boardPath: null,
      onChange,
      onError,
      debounceMs,
    });
    watcher.start();

    // FSEvents subscription is async: prime until the watch delivers an observable
    // change before rename-over-save stress (avoids start-vs-first-event misses).
    await writeFile(schematic, "prime");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    await waitForQuiet(
      () => onChange.mock.calls.length,
      debounceMs + 50,
      2_000,
    );
    onChange.mockClear();

    for (const content of ["first save", "second save"]) {
      const callsBefore = onChange.mock.calls.length;
      const replacement = join(
        root,
        `replacement-${content.replaceAll(" ", "-")}`,
      );
      await writeFile(replacement, content);
      await rename(replacement, schematic);
      await vi.waitFor(() => {
        expect(onChange.mock.calls.length).toBeGreaterThan(callsBefore);
      });
      await waitForQuiet(
        () => onChange.mock.calls.length,
        debounceMs + 50,
        2_000,
      );
    }

    watcher.stop();
    expect(onError).not.toHaveBeenCalled();
    expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onChange.mock.calls.every((call) => call[0] === "schematic")).toBe(
      true,
    );
  });

  it("refuses every automatic regeneration path, including active agent runs", () => {
    expect(() => refuseAutomaticExtraction(false)).toThrow(
      "explicit extraction request",
    );
    expect(() => refuseAutomaticExtraction(true)).toThrow(
      "during an agent run",
    );
  });
});
