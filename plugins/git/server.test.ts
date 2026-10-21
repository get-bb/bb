import { createServer } from "node:http";
import { createDeferredPromise } from "@bb/test-helpers";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  createFakePluginHost,
  makeMessageDispatchHookContext,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import type { ExperimentalHostWatchListener } from "@get-bb/plugin-sdk/host";
import { gitHostContract, gitRpcContract } from "./contract.js";
import { createGitHostEntry } from "./host.js";
import gitPlugin from "./server.js";

const exec = promisify(execFile);
it("keeps shared watched reads current across checkout changes and releases their host watches", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "bb-git-plugin-")));
  const git = (...args: string[]) =>
    exec("git", args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "BB",
        GIT_AUTHOR_EMAIL: "bb@example.com",
        GIT_COMMITTER_NAME: "BB",
        GIT_COMMITTER_EMAIL: "bb@example.com",
      },
    });
  let hostSuspended = false;
  const nativeWatches = new Map<string, ExperimentalHostWatchListener>();
  const entry = experimental_createHostEntryHarness(createGitHostEntry(), {
    experimental_paths: { dataDir: repo, tempDir: repo },
    experimental_watch(options, listener) {
      nativeWatches.set(options.rootPath, listener);
      return {
        async dispose() {
          nativeWatches.delete(options.rootPath);
        },
      };
    },
  });
  const environment = makeMessageDispatchHookContext({
    environment: {
      id: "env-git",
      path: repo,
      isGitRepo: true,
      status: "ready",
      hostId: "host-git",
    },
  }).environment;
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb--git",
    experimental_hostEntry: true,
    sdk: {
      plugins: {
        async callRpc(input) {
          return input.outputSchema.parse(
            await harness.behavior.callRpc(input.method, input.input),
          );
        },
      },
      environments: {
        get: async () => {
          if (!environment) throw new Error("Missing environment");
          return environment;
        },
      },
    },
    experimental_callHostRpc(call) {
      if (hostSuspended)
        throw Object.assign(new Error("Host is suspended"), {
          status: 502,
          body: {
            code: "host_unavailable",
            message: "Host is suspended",
            details: {
              reason: "suspended",
              hostStatus: "disconnected",
              suspendedAt: 1,
              destroyedAt: null,
            },
            retryable: false,
          },
        });
      switch (call.method) {
        case "status":
          return entry.experimental_call(
            "status",
            gitHostContract.status.input.parse(call.input),
          );
        case "files":
          return entry.experimental_call(
            "files",
            gitHostContract.files.input.parse(call.input),
          );
        case "branches":
          return entry.experimental_call(
            "branches",
            gitHostContract.branches.input.parse(call.input),
          );
        case "diff":
          return entry.experimental_call(
            "diff",
            gitHostContract.diff.input.parse(call.input),
          );
        case "patches":
          return entry.experimental_call(
            "patches",
            gitHostContract.patches.input.parse(call.input),
          );
        case "watch":
          return entry.experimental_call(
            "watch",
            gitHostContract.watch.input.parse(call.input),
          );
        case "unwatch":
          return entry.experimental_call(
            "unwatch",
            gitHostContract.unwatch.input.parse(call.input),
          );
        default:
          throw new Error(`Unexpected host call: ${call.method}`);
      }
    },
  });
  try {
    await git("init", "--initial-branch=main");
    await writeFile(join(repo, "file.txt"), "before\n");
    await git("add", ".");
    await git("commit", "-m", "initial");
    await gitPlugin(bb);
    const input = { environmentId: "env-git", mergeBaseBranch: null };
    const first = gitRpcContract.status.output.parse(
      await harness.behavior.callRpc("status", input),
    );
    expect(first).toMatchObject({
      outcome: "available",
      workspace: {
        checkout: { kind: "branch", branchName: "main" },
        workingTree: { fileCount: 0 },
      },
    });
    const stopFirst = await harness.behavior.experimental_watchRpc("status", {
      input,
    });
    const stopSecond = await harness.behavior.experimental_watchRpc("status", {
      input,
    });
    await expect.poll(() => nativeWatches.size).toBe(2);
    expect(
      harness.inspection.experimental_hostRpcCalls.filter(
        (call) => call.method === "watch",
      ),
    ).toHaveLength(1);
    await writeFile(join(repo, "file.txt"), "after\n");
    await nativeWatches.get(repo)?.({
      kind: "changed",
      changes: [{ path: join(repo, "file.txt"), type: "update" }],
    });
    const signal = entry.experimental_getSignals().at(-1);
    expect(signal).toBeDefined();
    if (signal)
      await harness.behavior.experimental_emitHostSignal(
        "host-git",
        signal.signal,
        signal.payload,
      );
    expect(harness.inspection.experimental_rpcChanges.at(-1)).toEqual({
      entity: "workspace",
      id: "env-git",
      changes: ["changed"],
    });
    const updated = gitRpcContract.status.output.parse(
      await harness.behavior.callRpc("status", input),
    );
    expect(updated).toMatchObject({
      outcome: "available",
      workspace: { workingTree: { fileCount: 1 } },
    });
    const files = gitRpcContract.files.output.parse(
      await harness.behavior.callRpc("files", {
        environmentId: "env-git",
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
      }),
    );
    expect(files).toMatchObject({
      outcome: "available",
      files: [{ path: "file.txt", additions: 1, deletions: 1 }],
      initialPatches: [
        { path: "file.txt", patch: expect.stringContaining("+after") },
      ],
    });
    const patchKey = JSON.stringify({
      environmentId: "env-git",
      target: { type: "uncommitted" },
      ignoreWhitespace: false,
      path: "file.txt",
    });
    const stopPatch = await harness.behavior.experimental_watchRpc("patches", {
      key: patchKey,
    });
    expect(
      harness.inspection.experimental_hostRpcCalls.filter(
        (call) => call.method === "watch",
      ),
    ).toHaveLength(1);
    const patches = gitRpcContract.patches.output.parse(
      await harness.behavior.callRpc("patches", { keys: [patchKey] }),
    );
    expect(patches[patchKey]?.patch).toContain("+after");
    await git("checkout", "-b", "feature/watched");
    await nativeWatches.get(join(repo, ".git"))?.({
      kind: "changed",
      changes: [{ path: join(repo, ".git", "HEAD"), type: "update" }],
    });
    const refSignal = entry.experimental_getSignals().at(-1);
    if (!refSignal) throw new Error("Missing ref signal");
    await harness.behavior.experimental_emitHostSignal(
      "host-git",
      refSignal.signal,
      refSignal.payload,
    );
    expect(harness.inspection.experimental_rpcChanges).toContainEqual({
      entity: "git-refs",
      id: "env-git",
      changes: ["changed"],
    });
    expect(await harness.behavior.callRpc("status", input)).toMatchObject({
      outcome: "available",
      workspace: { branch: { currentBranch: "feature/watched" } },
    });
    expect(harness.sdk.callsTo("environments.update")).toHaveLength(0);
    stopFirst();
    expect(nativeWatches.size).toBe(2);
    stopSecond();
    expect(nativeWatches.size).toBe(2);
    stopPatch();
    await expect.poll(() => nativeWatches.size).toBe(0);
    const cli = await harness.behavior.runCli([
      "status",
      "--environment",
      "env-git",
      "--json",
    ]);
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      outcome: "available",
      workspace: { workingTree: { fileCount: 1 } },
    });
    const mark = await harness.behavior.runCli([
      "viewed",
      "mark",
      "--environment",
      "env-git",
      "--path",
      "file.txt",
      "--json",
    ]);
    expect(mark.exitCode).toBe(0);
    const viewed = await harness.behavior.runCli([
      "viewed",
      "list",
      "--environment",
      "env-git",
      "--json",
    ]);
    expect(JSON.parse(viewed.stdout)).toMatchObject({
      files: [{ path: "file.txt", revision: expect.any(String) }],
    });
    const commitTarget = { type: "commit", sha: "abcdef" };
    await harness.behavior.callRpc("setViewed", {
      environmentId: "env-git",
      target: commitTarget,
      path: "file.txt",
      revision: "another-revision",
      viewed: true,
    });
    expect(
      (
        await harness.behavior.runCli([
          "viewed",
          "clear",
          "--environment",
          "env-git",
          "--json",
        ])
      ).exitCode,
    ).toBe(0);
    expect(
      await harness.behavior.callRpc("viewed", {
        environmentId: "env-git",
        target: { type: "uncommitted" },
      }),
    ).toEqual({ files: [] });
    expect(
      await harness.behavior.callRpc("viewed", {
        environmentId: "env-git",
        target: commitTarget,
      }),
    ).toEqual({ files: [{ path: "file.txt", revision: "another-revision" }] });
    const cliPatch = await harness.behavior.runCli([
      "patch",
      "--environment",
      "env-git",
      "--path",
      "file.txt",
      "--json",
    ]);
    expect(cliPatch.exitCode).toBe(0);
    expect(
      Object.values(
        gitRpcContract.patches.output.parse(JSON.parse(cliPatch.stdout)),
      )[0]?.patch,
    ).toContain("+after");
    const cliBranches = await harness.behavior.runCli([
      "branches",
      "--environment",
      "env-git",
      "--selected",
      "feature/watched",
      "--json",
    ]);
    expect(cliBranches.exitCode).toBe(0);
    expect(JSON.parse(cliBranches.stdout)).toMatchObject({
      branches: expect.arrayContaining(["feature/watched", "main"]),
    });
    for (const options of [
      ["--merge-base-branch", "main"],
      ["--sha", "abc123"],
      ["--target", "commit", "--sha", "abc123", "--merge-base-branch", "main"],
    ]) {
      const invalid = await harness.behavior.runCli([
        "diff",
        "--environment",
        "env-git",
        ...options,
      ]);
      expect(invalid.exitCode).not.toBe(0);
    }
    const missing = await entry.experimental_call("status", {
      ...gitHostContract.status.input.parse({
        path: join(repo, "missing"),
        mergeBaseBranch: null,
        maxFiles: 200,
        maxUntrackedLineStatFiles: 50,
        maxUntrackedLineStatBytes: 1024,
      }),
    });
    expect(missing).toMatchObject({
      outcome: "unavailable",
      failure: { code: "path_not_found" },
    });

    hostSuspended = true;
    const sleeping = gitRpcContract.status.output.parse(
      await harness.behavior.callRpc("status", input),
    );
    expect(sleeping).toMatchObject({
      outcome: "unavailable",
      failure: {
        kind: "lifecycle",
        status: 502,
        error: { code: "host_unavailable", details: { reason: "suspended" } },
      },
    });
    expect(
      (
        await harness.behavior.runCli([
          "status",
          "--environment",
          "env-git",
          "--json",
        ])
      ).exitCode,
    ).toBe(1);
  } finally {
    await harness.lifecycle.dispose();
    await entry.experimental_dispose();
    await rm(repo, { recursive: true, force: true });
  }
}, 15_000);

it("retains and drains a branch refresh when the host entry is disposed", async () => {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "bb-git-refresh-")));
  const git = (...args: string[]) => exec("git", args, { cwd: repo });
  const requested = createDeferredPromise<void>();
  const server = createServer(() => requested.resolve());
  const entry = experimental_createHostEntryHarness(createGitHostEntry());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing remote fixture address");
    await git("init", "--initial-branch=main");
    await git("config", "http.proxy", "");
    await git(
      "remote",
      "add",
      "origin",
      `http://127.0.0.1:${address.port}/repo`,
    );
    await entry.experimental_call("branches", {
      path: repo,
      query: "",
      selectedBranch: null,
      limit: 10,
    });
    await requested.promise;
    expect(entry.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    await entry.experimental_dispose();
    expect(entry.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await entry.experimental_dispose();
    await rm(repo, { recursive: true, force: true });
  }
}, 15_000);
