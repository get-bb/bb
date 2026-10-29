import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEnvironmentDiff } from "../../helpers/api.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../helpers/fixtures.js";
import { type IntegrationHarness, withHarness } from "../../helpers/harness.js";
import {
  createTestFile,
  createTestGitRepo,
  runGit,
} from "../../helpers/seed.js";
import { scaleTimeoutMs } from "../../helpers/time.js";

const TIMEOUT_MS = scaleTimeoutMs(10_000);

async function cloneWithDevBranch(
  harness: IntegrationHarness,
  name: string,
): Promise<string> {
  const reposRoot = path.dirname(harness.repoDir);
  const seed = await createTestGitRepo({
    repoDir: path.join(reposRoot, `${name}-seed`),
  });
  await runGit({ cwd: seed, args: ["switch", "--create", "dev"] });
  await createTestFile({
    filePath: path.join(seed, "dev.txt"),
    content: "dev\n",
  });
  await runGit({ cwd: seed, args: ["add", "dev.txt"] });
  await runGit({ cwd: seed, args: ["commit", "-m", "Commit on dev"] });
  await runGit({ cwd: seed, args: ["switch", "main"] });
  await runGit({ cwd: seed, args: ["branch", "release"] });
  const origin = path.join(reposRoot, `${name}-origin.git`);
  await runGit({ cwd: reposRoot, args: ["clone", "--bare", seed, origin] });
  const clone = path.join(reposRoot, name);
  await runGit({ cwd: reposRoot, args: ["clone", origin, clone] });
  await runGit({
    cwd: clone,
    args: ["config", "user.email", "integration-tests@example.com"],
  });
  await runGit({
    cwd: clone,
    args: ["config", "user.name", "BB Integration Tests"],
  });
  return clone;
}

describe.sequential("project checkout branches", () => {
  it("reads a new branch's diff against the branch it was made from", () =>
    withHarness(async (harness) => {
      const clone = await cloneWithDevBranch(harness, "merge-base");
      const project = await createProjectFixture(harness, {
        name: "Merge Base",
        path: clone,
      });
      const { environment } = await createReadyHostThread(harness, {
        projectId: project.id,
        timeoutMs: TIMEOUT_MS,
        workspace: {
          type: "unmanaged",
          path: clone,
          branch: { kind: "new", baseBranch: "origin/dev" },
        },
      });

      const diff = await getEnvironmentDiff(harness.api, harness.serverUrl, environment.id);
      expect(diff.files).toBe("");
      expect(environment.mergeBaseBranch).toBe("origin/dev");
    }));

  it("makes a new branch from origin's base in a fresh clone", () =>
    withHarness(async (harness) => {
      const clone = await cloneWithDevBranch(harness, "fresh-clone");
      const project = await createProjectFixture(harness, {
        name: "Fresh Clone",
        path: clone,
      });
      const { environment } = await createReadyHostThread(harness, {
        projectId: project.id,
        timeoutMs: TIMEOUT_MS,
        workspace: {
          type: "unmanaged",
          path: clone,
          branch: { kind: "new", baseBranch: "dev" },
        },
      });

      await createTestFile({
        filePath: path.join(clone, "thread.txt"),
        content: "thread\n",
      });
      await runGit({ cwd: clone, args: ["add", "thread.txt"] });
      await runGit({
        cwd: clone,
        args: ["commit", "-m", "Commit by the thread"],
      });

      const diff = await getEnvironmentDiff(harness.api, harness.serverUrl, environment.id);
      expect(diff.files).toBe("A\tthread.txt\n");
      expect(environment.mergeBaseBranch).toBe("origin/dev");
    }));

  it("switches to a branch a fresh clone holds only as origin's", () =>
    withHarness(async (harness) => {
      const clone = await cloneWithDevBranch(harness, "existing-branch");
      const project = await createProjectFixture(harness, {
        name: "Existing Branch",
        path: clone,
      });
      const { environment } = await createReadyHostThread(harness, {
        projectId: project.id,
        timeoutMs: TIMEOUT_MS,
        workspace: {
          type: "unmanaged",
          path: clone,
          branch: { kind: "existing", name: "release" },
        },
      });

      expect(environment.branchName).toBe("release");
      expect(
        await runGit({
          cwd: clone,
          args: ["rev-parse", "--abbrev-ref", "release@{upstream}"],
        }),
      ).toBe("origin/release\n");
    }));
});
