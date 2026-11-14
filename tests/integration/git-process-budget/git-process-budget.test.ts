import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHostWatcher } from "@bb/host-watcher";
import { createNodeBbSdk } from "@bb/sdk/node";
import type { CreateThreadRequest } from "@bb/server-contract";
import {
  createDeferredPromise,
  listPreferredTestModels,
} from "@bb/test-helpers";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { WatchManager } from "../../../apps/host-daemon/src/watch-manager.js";
import { createWorktreeHostEntry } from "../../../plugins/environment-git-worktree/host.js";
import {
  createReuseThread,
  getEnvironment,
  getEnvironmentBranches,
  getEnvironmentStatus,
} from "../helpers/api.js";
import {
  waitForEnvironmentStatus,
  waitForThreadStatus,
} from "../helpers/assertions.js";
import { createProjectFixture } from "../helpers/fixtures.js";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../helpers/harness.js";
import {
  installGitRecorder,
  type GitCall,
  type GitRecorder,
} from "./git-recorder.js";
import {
  advanceBase,
  createBudgetRepository,
  REPOSITORY_SIZES,
  type BudgetRepository,
  type RepositorySize,
} from "./repository.js";

const THREAD_TIMEOUT_MS = 60_000;
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
]);
const SUBCOMMANDS_WITH_ACTION = new Set(["worktree", "remote", "stash"]);

function describeCall(call: GitCall): string {
  let index = 0;
  while (index < call.args.length && call.args[index]!.startsWith("-")) {
    index += GLOBAL_OPTIONS_WITH_VALUE.has(call.args[index]!) ? 2 : 1;
  }
  const subcommand = call.args[index] ?? "";
  const rest = call.args.slice(index + 1);
  const action =
    SUBCOMMANDS_WITH_ACTION.has(subcommand) && !rest[0]?.startsWith("-")
      ? rest.slice(0, 1)
      : [];
  const flags = rest
    .filter((arg) => arg.startsWith("-"))
    .map((arg) => arg.replace(/^(--(?:format|pretty))=.*$/su, "$1=…"));
  return [subcommand, ...action, ...flags].join(" ");
}

function countBySubcommand(calls: readonly GitCall[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of calls.map(describeCall).sort()) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

let root = "";
let recorder: GitRecorder;
let harness: IntegrationHarness;
const report: Record<
  string,
  Partial<Record<RepositorySize, Record<string, number>>>
> = {};
const restoreEnv: Array<() => void> = [];

function setEnv(key: string, value: string): void {
  const previous = process.env[key];
  process.env[key] = value;
  restoreEnv.push(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

async function installFakeGh(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const noPullRequest = JSON.stringify({
    data: {
      p0: {
        defaultBranchRef: { name: "main" },
        pullRequests: { nodes: [] },
      },
    },
  });
  await fs.writeFile(
    path.join(dir, "gh"),
    [
      "#!/bin/sh",
      'case "$*" in',
      `  *graphql*) printf '%s' '${noPullRequest}' ;;`,
      '  *) echo "fake gh supports only api graphql" >&2; exit 1 ;;',
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

async function newRepository(size: RepositorySize): Promise<BudgetRepository> {
  return createBudgetRepository({ root, realGit: recorder.realGit, size });
}

async function newProject(repository: BudgetRepository): Promise<string> {
  const project = await createProjectFixture(harness, {
    name: path.basename(path.dirname(repository.checkout)),
    path: repository.checkout,
  });
  return project.id;
}

async function startThread(
  projectId: string,
  environment: CreateThreadRequest["environment"],
): Promise<string> {
  const response = await harness.api.threads.$post({
    json: {
      environment,
      input: [{ type: "text", text: "budget", mentions: [] }],
      origin: "app",
      model: listPreferredTestModels("fake")[0] ?? "fake-model",
      projectId,
      providerId: "fake",
      startedOnBehalfOf: null,
      originKind: null,
    },
  });
  if (response.status !== 201) {
    throw new Error(`Thread create failed: ${await response.text()}`);
  }
  const { id } = z.object({ id: z.string() }).parse(await response.json());
  const idle = await waitForThreadStatus(
    harness.api,
    id,
    "idle",
    THREAD_TIMEOUT_MS,
  );
  if (idle.environmentId === null) throw new Error("Thread has no environment");
  await waitForEnvironmentStatus(
    harness.api,
    idle.environmentId,
    "ready",
    THREAD_TIMEOUT_MS,
  );
  return idle.environmentId;
}

function providerEnvironment(
  environmentProviderId: "git-worktree" | "project-checkout",
): CreateThreadRequest["environment"] {
  return {
    type: "provider",
    environmentProviderId,
    machine: { type: "existing", hostId: harness.hostId },
    inputs:
      environmentProviderId === "git-worktree"
        ? { branch: { kind: "default" } }
        : {},
  };
}

async function measure(run: () => Promise<void>): Promise<GitCall[]> {
  await recorder.settle();
  await run();
  return recorder.settle();
}

const OPERATIONS: Record<string, (size: RepositorySize) => Promise<GitCall[]>> =
  {
    async "create a thread on a new worktree"(size) {
      const projectId = await newProject(await newRepository(size));
      return measure(async () => {
        await startThread(projectId, providerEnvironment("git-worktree"));
      });
    },
    async "create a thread on an existing environment"(size) {
      const projectId = await newProject(await newRepository(size));
      const environmentId = await startThread(
        projectId,
        providerEnvironment("git-worktree"),
      );
      return measure(async () => {
        const thread = await createReuseThread(harness.api, {
          environmentId,
          input: [{ type: "text", text: "budget", mentions: [] }],
          projectId,
          providerId: "fake",
        });
        await waitForThreadStatus(
          harness.api,
          thread.id,
          "idle",
          THREAD_TIMEOUT_MS,
        );
      });
    },
    async "refresh a reused environment's branch"(size) {
      const projectId = await newProject(await newRepository(size));
      const first = await startThread(
        projectId,
        providerEnvironment("project-checkout"),
      );
      let second = "";
      const calls = await measure(async () => {
        second = await startThread(
          projectId,
          providerEnvironment("project-checkout"),
        );
      });
      expect(second).toBe(first);
      return calls;
    },
    async "read environment status"(size) {
      const repository = await newRepository(size);
      const projectId = await newProject(repository);
      const environmentId = await startThread(
        projectId,
        providerEnvironment("git-worktree"),
      );
      const worktree = (await getEnvironment(harness.api, environmentId)).path;
      if (worktree === null) throw new Error("Environment has no path");
      await fs.writeFile(
        path.join(worktree, "src", "feature.ts"),
        "export const feature = 1;\n",
      );
      await repository.git(worktree, ["add", "src/feature.ts"]);
      await repository.git(worktree, ["commit", "-q", "-m", "feature"]);
      await advanceBase(repository, size);
      let behindCount: number | null = null;
      const calls = await measure(async () => {
        const result = await getEnvironmentStatus(
          harness.api,
          harness.serverUrl,
          environmentId,
        );
        if (result.outcome === "available") {
          behindCount = result.workspace.mergeBase?.behindCount ?? null;
        }
      });
      expect(behindCount).toBe(REPOSITORY_SIZES[size].baseCommits);
      return calls;
    },
    async "open the composer branch picker"(size) {
      const projectId = await newProject(await newRepository(size));
      return measure(async () => {
        const response = await harness.api.projects[":id"][
          "branch-options"
        ].$get({
          param: { id: projectId },
          query: { hostId: harness.hostId },
        });
        expect(response.status).toBe(200);
      });
    },
    async "open the merge-base branch picker"(size) {
      const projectId = await newProject(await newRepository(size));
      const environmentId = await startThread(
        projectId,
        providerEnvironment("git-worktree"),
      );
      return measure(async () => {
        await getEnvironmentBranches(harness.serverUrl, environmentId);
      });
    },
    async "create a worktree"(size) {
      const repository = await newRepository(size);
      const dataDir = path.join(
        path.dirname(repository.checkout),
        "worktree-plugin-data",
      );
      const host = experimental_createHostEntryHarness(
        createWorktreeHostEntry(),
        { experimental_paths: { dataDir, tempDir: path.join(dataDir, "tmp") } },
      );
      return measure(async () => {
        const result = await host.experimental_call("create", {
          operationId: "budget",
          sourcePath: repository.checkout,
          pathKey: "budget",
          branchName: "bb/budget",
          baseBranch: { kind: "default" },
          branchMode: "reset",
        });
        expect(result.status).toBe("created");
      });
    },
    async "start the workspace watcher"(size) {
      const repository = await newRepository(size);
      const metadata = createDeferredPromise<void>();
      const manager = new WatchManager({
        hostWatcher: createHostWatcher(),
        onWorkspaceMetadataChanged: () => metadata.resolve(),
      });
      try {
        return await measure(async () => {
          await manager.replaceWatchSet({
            generation: 1,
            workspaceTargets: [
              {
                environmentId: "env-budget",
                workspaceContext: { workspacePath: repository.worktrees[0]! },
                mergeBaseBranch: "main",
              },
            ],
            threadStorageTargets: [],
          });
          await metadata.promise;
        });
      } finally {
        await manager.shutdown();
      }
    },
    async "load GitHub PR status"(size) {
      const projectId = await newProject(await newRepository(size));
      const environmentId = await startThread(
        projectId,
        providerEnvironment("git-worktree"),
      );
      return measure(async () => {
        await createNodeBbSdk({ baseUrl: harness.serverUrl }).plugins.callRpc({
          pluginId: "bb--github-pr-status",
          method: "pullRequests",
          input: { keys: [environmentId] },
          outputSchema: z.unknown(),
        });
      });
    },
  };

describe.skipIf(process.platform === "win32")(
  "git processes per operation do not grow with repository size",
  () => {
    beforeAll(async () => {
      root = await fs.realpath(
        await fs.mkdtemp(path.join(tmpdir(), "bb-git-budget-")),
      );
      recorder = await installGitRecorder(root);
      const ghDir = path.join(root, "gh");
      await installFakeGh(ghDir);
      await fs.mkdir(path.join(root, "home"));
      await fs.writeFile(path.join(root, "gitconfig"), "");
      setEnv(
        "PATH",
        [recorder.shimDir, ghDir, process.env.PATH].join(path.delimiter),
      );
      setEnv("HOME", path.join(root, "home"));
      setEnv("GIT_CONFIG_GLOBAL", path.join(root, "gitconfig"));
      setEnv("GIT_CONFIG_NOSYSTEM", "1");
      setEnv("GH_CONFIG_DIR", ghDir);
      harness = await createIntegrationHarness({
        builtinPlugins: ["environment-git-worktree", "git", "github-pr-status"],
      });
    }, 120_000);

    afterAll(async () => {
      await harness?.cleanup();
      for (const restore of restoreEnv.reverse()) restore();
      if (process.env.BB_GIT_PROCESS_REPORT) {
        await fs.writeFile(
          process.env.BB_GIT_PROCESS_REPORT,
          `${JSON.stringify(report, null, 2)}\n`,
        );
      }
      await fs.rm(root, { recursive: true, force: true });
    }, 120_000);

    for (const [name, run] of Object.entries(OPERATIONS)) {
      it(
        name,
        async () => {
          const temp = await fs.realpath(tmpdir());
          const calls = { few: await run("few"), many: await run("many") };
          for (const call of [...calls.few, ...calls.many]) {
            expect(
              call.cwd.startsWith(temp),
              `git ran outside the temp directory: ${call.cwd}`,
            ).toBe(true);
          }
          const few = countBySubcommand(calls.few);
          const many = countBySubcommand(calls.many);
          report[name] = { few, many };
          const grown = Object.entries(many).filter(
            ([key, count]) => count > (few[key] ?? 0),
          );
          expect(
            calls.many.length,
            `${name} spawned ${calls.few.length} git processes with ${JSON.stringify(REPOSITORY_SIZES.few)} and ${calls.many.length} with ${JSON.stringify(REPOSITORY_SIZES.many)}. Grown: ${JSON.stringify(Object.fromEntries(grown.map(([key, count]) => [key, `${few[key] ?? 0} -> ${count}`])))}`,
          ).toBeLessThanOrEqual(calls.few.length);
        },
        300_000,
      );
    }
  },
);
