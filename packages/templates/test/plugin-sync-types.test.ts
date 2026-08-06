import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncPluginTypes } from "../src/plugin-scaffold.js";

/**
 * `bb plugin new` seeds types/ once, but the SDK surface grows every release,
 * so a plugin scaffolded months ago typechecks against declarations that no
 * longer describe the running bb. syncPluginTypes is the refresh; these guard
 * the behavior the CLI (`bb plugin types`, build, dev) depends on.
 */
describe("syncPluginTypes", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "bb-sync-types-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("replaces a stale declaration and creates a missing types/", async () => {
    const results = await syncPluginTypes({ rootDir, app: false });

    expect(results).toEqual([
      { path: "types/bb-plugin-sdk.d.ts", outcome: "written" },
    ]);
    const written = await readFile(
      join(rootDir, "types", "bb-plugin-sdk.d.ts"),
      "utf8",
    );
    expect(written).toContain("interface BbPluginApi");

    await writeFile(join(rootDir, "types", "bb-plugin-sdk.d.ts"), "// stale\n");
    const refreshed = await syncPluginTypes({ rootDir, app: false });
    expect(refreshed[0]?.outcome).toBe("written");
    expect(
      await readFile(join(rootDir, "types", "bb-plugin-sdk.d.ts"), "utf8"),
    ).toContain("interface BbPluginApi");
  });

  it("reports unchanged instead of rewriting a current declaration", async () => {
    await syncPluginTypes({ rootDir, app: false });
    const before = await stat(join(rootDir, "types", "bb-plugin-sdk.d.ts"));

    const results = await syncPluginTypes({ rootDir, app: false });

    expect(results).toEqual([
      { path: "types/bb-plugin-sdk.d.ts", outcome: "unchanged" },
    ]);
    const after = await stat(join(rootDir, "types", "bb-plugin-sdk.d.ts"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("never creates app types a headless plugin did not ask for", async () => {
    await syncPluginTypes({ rootDir, app: false });

    await expect(
      readFile(join(rootDir, "types", "bb-plugin-sdk-app.d.ts"), "utf8"),
    ).rejects.toThrow();
  });

  it("refreshes existing app types even when the caller reports no bb.app", async () => {
    // A manifest read can fail or predate the frontend entry; an app
    // declaration already on disk must not be left stale because of it.
    await mkdir(join(rootDir, "types"), { recursive: true });
    await writeFile(
      join(rootDir, "types", "bb-plugin-sdk-app.d.ts"),
      "// stale\n",
    );

    const results = await syncPluginTypes({ rootDir, app: false });

    expect(results).toContainEqual({
      path: "types/bb-plugin-sdk-app.d.ts",
      outcome: "written",
    });
    expect(
      await readFile(join(rootDir, "types", "bb-plugin-sdk-app.d.ts"), "utf8"),
    ).toContain("definePluginApp");
  });

  it("check mode reports stale files and writes nothing", async () => {
    const missing = await syncPluginTypes({ rootDir, app: true, check: true });
    expect(missing).toEqual([
      { path: "types/bb-plugin-sdk.d.ts", outcome: "stale" },
      { path: "types/bb-plugin-sdk-app.d.ts", outcome: "stale" },
    ]);
    await expect(stat(join(rootDir, "types"))).rejects.toThrow();

    await syncPluginTypes({ rootDir, app: true });
    const current = await syncPluginTypes({ rootDir, app: true, check: true });
    expect(current.every((file) => file.outcome === "unchanged")).toBe(true);
  });
});
