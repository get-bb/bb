import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertBenchArtifactRootIgnored,
  BENCH_ARTIFACT_DIRECTORY,
  normalizeProbeScriptPath,
  openProbeStore,
  parseProbeHeader,
  ProbeStoreError,
  writeBenchArtifact,
} from "./store.js";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function worktree(ignored = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-probe-store-"));
  cleanup.push(root);
  execFileSync("git", ["init", "--quiet", root]);
  await writeFile(join(root, ".gitignore"), ignored ? ".fs-bench/\n" : "", "utf8");
  return root;
}

const source = `"""
hypothesis: scheduler corrupts the ready list
devices: probe-rs:serial-a, probe-rs:serial-b
expected discriminating observation: pxReadyTasksLists contains a cycle
"""
from fs_probe import outcome
outcome("confirmed")
`;

describe("probe store", () => {
  it("parses the structured docstring header", () => {
    expect(parseProbeHeader(source)).toEqual({
      hypothesis: "scheduler corrupts the ready list",
      devices: ["probe-rs:serial-a", "probe-rs:serial-b"],
      expectedObservation: "pxReadyTasksLists contains a cycle",
    });
  });

  it.each([
    "../escape.py", "/tmp/escape.py", ".fs/bench/probes/../../escape.py",
    ".fs/bench/probes/nested/name.py", ".fs/bench/probes/bad\\name.py", "bad\0name.py",
  ])("rejects unsafe probe path %s", (path) => {
    expect(() => normalizeProbeScriptPath(path)).toThrow(ProbeStoreError);
  });

  it("creates scripts inside source control and leaves unchanged rewrites untouched", async () => {
    const root = await worktree();
    const store = await openProbeStore(root);
    const first = await store.create("scheduler-cycle", source);
    const second = await store.create("scheduler-cycle", source);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await readFile(first.script.absolutePath, "utf8")).toBe(source);
    expect(execFileSync("git", ["-C", root, "status", "--short", "--", first.script.path], { encoding: "utf8" }))
      .toContain(first.script.path);
  });

  it("fails before artifact writes when unignored and refuses a symlink artifact root", async () => {
    const unignored = await worktree(false);
    await expect(writeBenchArtifact(unignored, "run-1", "capture.csv", Buffer.from("x")))
      .rejects.toMatchObject({ code: "BENCH_ARTIFACT_ROOT_NOT_IGNORED" });
    await expect(access(join(unignored, BENCH_ARTIFACT_DIRECTORY))).rejects.toMatchObject({ code: "ENOENT" });

    const linked = await worktree(true);
    const outside = await mkdtemp(join(tmpdir(), "fs-probe-outside-"));
    cleanup.push(outside);
    await symlink(outside, join(linked, BENCH_ARTIFACT_DIRECTORY), "dir");
    await expect(assertBenchArtifactRootIgnored(linked)).rejects.toMatchObject({ code: "BENCH_ARTIFACT_ROOT_UNSAFE" });
    await expect(writeBenchArtifact(linked, "run-1", "capture.csv", Buffer.from("secret")))
      .rejects.toMatchObject({ code: "BENCH_ARTIFACT_ROOT_UNSAFE" });
    await expect(access(join(outside, "run-1"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes artifacts only beneath the ignored root", async () => {
    const root = await worktree(true);
    await expect(writeBenchArtifact(root, "run-1", "captures/data.csv", Buffer.from("a,b\n")))
      .resolves.toBe(".fs-bench/run-1/captures/data.csv");
    expect(await readFile(join(root, ".fs-bench/run-1/captures/data.csv"), "utf8")).toBe("a,b\n");
  });
});
