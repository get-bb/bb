import { execFile, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it } from "vitest";
import { createRiftHostEntry } from "./host.js";

const exec = promisify(execFile);

describe("Rift host entry", () => {
  it.runIf(spawnSync("rift", ["--help"]).status === 0)(
    "creates a real copy, preserves dirty files, runs hooks, replays, repairs and removes",
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "bb-rift-")));
      const source = join(root, "repo");
      const dataDir = join(root, "data");
      await mkdir(source);
      await mkdir(dataDir);
      const git = async (...args: string[]) =>
        (await exec("git", args, { cwd: source })).stdout.trim();
      const harness = experimental_createHostEntryHarness(
        createRiftHostEntry(),
        {
          experimental_paths: { dataDir, tempDir: join(root, "temp") },
        },
      );
      const input = {
        operationId: "create",
        sourcePath: source,
        pathKey: "attempt-1",
        branchName: "bb/rift-test",
        copy: "all" as const,
        setupTimeoutMs: 30_000,
      };
      try {
        await git("init", "-b", "main");
        await git(
          "-c",
          "user.name=BB",
          "-c",
          "user.email=bb@example.com",
          "commit",
          "--allow-empty",
          "-m",
          "initial",
        );
        await writeFile(join(source, "dirty.txt"), "dirty");
        await mkdir(join(source, "node_modules"));
        await writeFile(join(source, "node_modules", "sentinel"), "dependency");
        await writeFile(
          join(source, ".rift.toml"),
          'version = 1\n[[hooks.postcreate]]\nrun = "echo rift > hook-order"\n',
        );
        await writeFile(
          join(source, ".bb-env-setup.sh"),
          "test -f hook-order && echo bb >> hook-order\n",
        );
        expect(await harness.experimental_call("availability", {})).toEqual({
          installed: true,
        });
        expect(
          await Promise.all(
            Array.from({ length: 8 }, () =>
              harness.experimental_call("validate", { sourcePath: source }),
            ),
          ),
        ).toEqual(Array.from({ length: 8 }, () => ({ status: "accept" })));
        const result = await harness.experimental_call("create", input);
        expect(result.status).toBe("created");
        if (result.status !== "created") throw new Error(result.message);
        expect(await readFile(join(result.path, "hook-order"), "utf8")).toBe(
          "rift\nbb\n",
        );
        expect(await readFile(join(result.path, "dirty.txt"), "utf8")).toBe(
          "dirty",
        );
        await access(join(result.path, "node_modules", "sentinel"));
        await writeFile(join(result.path, "keep-on-replay"), "kept");
        expect(await harness.experimental_call("create", input)).toEqual(
          result,
        );
        await access(join(result.path, "keep-on-replay"));
        expect(await git("branch", "--show-current")).toBe("main");
        await exec("git", ["checkout", "--detach"], { cwd: result.path });
        expect((await harness.experimental_call("create", input)).status).toBe(
          "created",
        );
        await expect(
          access(join(result.path, "keep-on-replay")),
        ).rejects.toThrow();
        expect(
          await harness.experimental_call("remove", {
            operationId: "remove",
            pathKey: input.pathKey,
            path: result.path,
            teardownTimeoutMs: 30_000,
          }),
        ).toEqual({ status: "removed" });
        await expect(access(result.path)).rejects.toThrow();
        expect(
          await harness.experimental_call("remove", {
            operationId: "remove",
            pathKey: input.pathKey,
            path: null,
            teardownTimeoutMs: 30_000,
          }),
        ).toEqual({ status: "removed" });
        expect(
          (
            await harness.experimental_call("remove", {
              operationId: "remove",
              pathKey: input.pathKey,
              path: source,
              teardownTimeoutMs: 30_000,
            })
          ).status,
        ).toBe("failed");
        await writeFile(
          join(source, ".rift.toml"),
          'version = 1\n[[hooks.postcreate]]\nrun = "git -c user.name=BB -c user.email=bb@example.com commit --allow-empty -m hook && echo rift > hook-order"\n',
        );
        const filtered = await harness.experimental_call("create", {
          ...input,
          pathKey: "hook-head",
          branchName: "main",
          copy: "all",
        });
        if (filtered.status !== "created") throw new Error(filtered.message);
        expect(filtered.mergeBaseBranch).toBe(
          (
            await exec("git", ["rev-parse", "HEAD"], { cwd: filtered.path })
          ).stdout.trim(),
        );
        expect(filtered.mergeBaseBranch).not.toBe(
          await git("rev-parse", "HEAD"),
        );
        await writeFile(
          join(source, ".rift.toml"),
          'version = 1\n[[hooks.postcreate]]\nrun = "touch started; sleep 2; touch orphan-finished"\n',
        );
        const controller = new AbortController();
        const cancelledPath = join(
          dataDir,
          "workspaces",
          "cancel",
          "workspace",
        );
        const creating = harness.experimental_call(
          "create",
          { ...input, pathKey: "cancel" },
          { signal: controller.signal },
        );
        const observed = creating.catch((error) => error);
        await expect
          .poll(async () =>
            access(join(cancelledPath, "started")).then(
              () => true,
              () => false,
            ),
          )
          .toBe(true);
        controller.abort();
        expect(await observed).toBeInstanceOf(Error);
        await delay(2200);
        await expect(
          access(join(cancelledPath, "orphan-finished")),
        ).rejects.toThrow();
      } finally {
        await exec("rift", ["remove", "-f", source]).catch(() => {});
        await harness.experimental_dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it.runIf(spawnSync("rift", ["--help"]).status === 0).each([
    { name: "empty completion", record: "", hook: "true" },
    { name: "bogus completion", record: "0".repeat(40), hook: "true" },
    {
      name: "postcreate selects requested branch",
      record: null,
      hook: "git checkout main",
    },
  ])(
    "repairs $name and preserves index and working tree",
    async ({ record, hook }) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "bb-rift-repair-")),
      );
      const source = join(root, "repo");
      const dataDir = join(root, "data");
      await mkdir(source);
      await mkdir(dataDir);
      const git = async (cwd: string, ...args: string[]) =>
        (await exec("git", args, { cwd })).stdout.trim();
      const harness = experimental_createHostEntryHarness(
        createRiftHostEntry(),
        {
          experimental_paths: { dataDir, tempDir: join(root, "temp") },
        },
      );
      const input = {
        operationId: "repair",
        sourcePath: source,
        pathKey: "repair",
        branchName: "main",
        copy: "all" as const,
        setupTimeoutMs: 30_000,
      };
      try {
        await git(source, "init", "-b", "main");
        await writeFile(join(source, "tracked"), "base\n");
        await git(source, "add", "tracked");
        await git(
          source,
          "-c",
          "user.name=BB",
          "-c",
          "user.email=bb@example.com",
          "commit",
          "-m",
          "initial",
        );
        const head = await git(source, "rev-parse", "HEAD");
        await writeFile(join(source, "tracked"), "staged\n");
        await git(source, "add", "tracked");
        await writeFile(join(source, "tracked"), "unstaged\n");
        await writeFile(
          join(source, ".rift.toml"),
          `version = 1\n[[hooks.postcreate]]\nrun = "${hook}"\n`,
        );
        const first = await harness.experimental_call("create", input);
        expect(first.status).toBe("created");
        if (first.status !== "created") throw new Error(first.message);
        if (record !== null) {
          await writeFile(`${first.path}.completed`, record);
          await writeFile(join(first.path, "incomplete-only"), "discard");
          expect(await harness.experimental_call("create", input)).toEqual(
            first,
          );
          await expect(
            access(join(first.path, "incomplete-only")),
          ).rejects.toThrow();
        }
        expect(first.mergeBaseBranch).toBe(head);
        expect(await readFile(`${first.path}.completed`, "utf8")).toBe(head);
        expect(await git(first.path, "branch", "--show-current")).toBe("main");
        expect(await git(first.path, "rev-parse", "HEAD")).toBe(head);
        expect(await git(first.path, "show", ":tracked")).toBe("staged");
        expect(await readFile(join(first.path, "tracked"), "utf8")).toBe(
          "unstaged\n",
        );
        expect(await git(source, "rev-parse", "HEAD")).toBe(head);
      } finally {
        await exec("rift", ["remove", "-f", source]).catch(() => {});
        await harness.experimental_dispose();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("reports a missing CLI without crashing the host entry", async () => {
    const harness = experimental_createHostEntryHarness(
      createRiftHostEntry(async () => {
        throw new Error("ENOENT");
      }),
    );
    expect(await harness.experimental_call("availability", {})).toEqual({
      installed: false,
    });
    await harness.experimental_dispose();
  });
});
