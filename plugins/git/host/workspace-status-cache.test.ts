import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { WorkspaceReads } from "./workspace-reads.js";
import { runGit } from "bb-environment-provider-host/workspace-git";

let freshReads = 0;
function fresh() {
  freshReads += 1;
  return { work: `work-${freshReads}`, refs: `refs-${freshReads}` };
}

vi.mock("bb-environment-provider-host/workspace-git", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bb-environment-provider-host/workspace-git")>();
  return { ...actual, runGit: vi.fn(actual.runGit) };
});

afterEach(() => vi.clearAllMocks());

it("reuses committed comparisons across readers while refreshing edits and moved refs", async () => {
  const repo = await initRepo(await makeTempDir("bb-status-cache-"));
  await runGit(["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "feature.txt"), "feature\n");
  await fs.writeFile(path.join(repo, "other.txt"), "other\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Feature"], { cwd: repo });
  const read = (maxFiles = 200) =>
    new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(), mergeBaseBranch: "main", maxFiles });
  const comparisons = () =>
    vi
      .mocked(runGit)
      .mock.calls.filter(([args]) => args.includes("--left-right")).length;

  const [first, concurrent] = await Promise.all([read(), read()]);
  expect(first.mergeBase).toMatchObject({
    aheadCount: 1,
    behindCount: 0,
    fileCount: 2,
  });
  expect(concurrent.mergeBase).toEqual(first.mergeBase);
  expect(comparisons()).toBe(1);
  first.mergeBase?.files.splice(0);

  await fs.writeFile(path.join(repo, "feature.txt"), "edited\n");
  const edited = await read();
  expect(edited.workingTree.hasUncommittedChanges).toBe(true);
  expect(edited.mergeBase?.files).toHaveLength(2);
  expect(comparisons()).toBe(1);

  const limited = await read(1);
  expect(limited.mergeBase?.fileCount).toBe(2);
  expect(limited.mergeBase?.files).toHaveLength(1);

  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Second feature"], { cwd: repo });
  expect((await read()).mergeBase?.aheadCount).toBe(2);

  await runGit(["branch", "-f", "main", "HEAD"], { cwd: repo });
  expect((await read()).mergeBase).toMatchObject({
    aheadCount: 0,
    fileCount: 0,
  });

  await runGit(["reset", "--hard", "HEAD~1"], { cwd: repo });
  expect((await read()).mergeBase).toMatchObject({
    aheadCount: 0,
    behindCount: 1,
  });
});

it("returns degraded comparisons on Git failures without caching them", async () => {
  const repo = await initRepo(await makeTempDir("bb-status-cache-failure-"));
  await runGit(["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "feature.txt"), "feature\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Feature"], { cwd: repo });
  const actual =
    await vi.importActual<typeof import("bb-environment-provider-host/workspace-git")>("bb-environment-provider-host/workspace-git");
  let fail = true;
  vi.mocked(runGit).mockImplementation(async (args, options) => {
    if (
      options.cwd === repo &&
      args.includes("--numstat") &&
      args.some((arg) => arg.includes("...")) &&
      fail
    ) {
      fail = false;
      return { stdout: "", stderr: "comparison failed", exitCode: 1 };
    }
    return actual.runGit(args, options);
  });
  const read = () => new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  try {
    expect((await read()).mergeBase).toMatchObject({
      aheadCount: 1,
      fileCount: 1,
      insertions: 0,
      lineStatsComplete: false,
    });
    expect((await read()).mergeBase).toMatchObject({
      aheadCount: 1,
      fileCount: 1,
      insertions: 1,
      lineStatsComplete: true,
    });
  } finally {
    vi.mocked(runGit).mockImplementation(actual.runGit);
  }
});

async function createDivergedRepo({
  featureText = "feature\n",
  featurePath = "feature.txt",
  basePath = "main.txt",
  baseText = "main\n",
} = {}) {
  const repo = await initRepo(await makeTempDir("bb-squash-budget-"));
  await runGit(["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, featurePath), featureText);
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Feature"], { cwd: repo });
  await runGit(["checkout", "main"], { cwd: repo });
  await fs.writeFile(path.join(repo, basePath), baseText);
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Main"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });
  return repo;
}

async function advanceMain(repo: string, count: number) {
  const parent = (
    await runGit(["rev-parse", "main"], { cwd: repo })
  ).stdout.trim();
  const timestamp = Math.floor(Date.now() / 1000);
  const input = Array.from(
    { length: count },
    (_, i) =>
      `commit refs/heads/main\nmark :${i + 1}\ncommitter Test <test@example.com> ${timestamp + i} +0000\ndata 4\nMain\nfrom ${i === 0 ? parent : `:${i}`}\n\n`,
  ).join("");
  await runGit(["fast-import", "--quiet"], { cwd: repo, input });
}

it("filters irrelevant history beyond 200 commits and reports incomplete only at the metadata limit", async () => {
  const repo = await createDivergedRepo();
  await advanceMain(repo, 200);
  const underLimit = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
    mergeBaseBranch: "main",
  });
  expect(underLimit.mergeBase).toMatchObject({
    squashMergeCheckComplete: true,
    aheadCount: 1,
    behindCount: 201,
  });
  await advanceMain(repo, 800);
  const workspace = new WorkspaceReads(repo, tmpdir());
  const result = await workspace.getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  expect(result.mergeBase).toMatchObject({
    squashMergeCheckComplete: false,
    aheadCount: 1,
    behindCount: 1001,
    fileCount: 1,
  });
  const patchCommands = () =>
    vi
      .mocked(runGit)
      .mock.calls.filter(
        ([args, options]) =>
          options.cwd === repo &&
          (args[0] === "patch-id" ||
            (args.includes("-p") && args[0] === "log")),
      );
  expect(patchCommands()).toHaveLength(0);
  const comparisons = () =>
    vi
      .mocked(runGit)
      .mock.calls.filter(
        ([args, options]) =>
          options.cwd === repo && args.includes("--left-right"),
      ).length;
  const comparisonsBeforeRefresh = comparisons();
  await fs.writeFile(path.join(repo, "feature.txt"), "edited\n");
  const refreshed = await workspace.getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  expect(refreshed.workingTree.hasUncommittedChanges).toBe(true);
  expect(refreshed.mergeBase).toEqual(result.mergeBase);
  expect(patchCommands()).toHaveLength(0);
  expect(comparisons()).toBe(comparisonsBeforeRefresh);
}, 20_000);

it("cancels an over-budget squash command and returns basic comparison data", async () => {
  const repo = await createDivergedRepo({ basePath: "feature.txt" });
  const actual =
    await vi.importActual<typeof import("bb-environment-provider-host/workspace-git")>("bb-environment-provider-host/workspace-git");
  let canceled = false;
  vi.mocked(runGit).mockImplementation((args, options) => {
    if (options.cwd === repo && args[0] === "patch-id" && options.signal) {
      return new Promise((_, reject) => {
        const onAbort = () => {
          canceled = true;
          reject(new Error("Aborted slow patch hashing"));
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
      });
    }
    return actual.runGit(args, options);
  });
  try {
    const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(canceled).toBe(true);
    expect(status.mergeBase).toMatchObject({
      squashMergeCheckComplete: false,
      aheadCount: 1,
      behindCount: 1,
    });
    expect(status.workingTree.hasUncommittedChanges).toBe(false);
  } finally {
    vi.mocked(runGit).mockImplementation(actual.runGit);
  }
}, 10_000);

it("stops oversized patch collection without claiming the branch is merged", async () => {
  const repo = await createDivergedRepo({
    featureText: "large line\n".repeat(850_000),
    basePath: "feature.txt",
  });
  const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
    mergeBaseBranch: "main",
  });
  expect(status.mergeBase).toMatchObject({
    squashMergeCheckComplete: false,
    aheadCount: 1,
    fileCount: 1,
  });
}, 20_000);

it.each([
  "feature.txt",
  "space name.txt",
  "café.txt",
  "0".repeat(40),
  ...(process.platform === "win32" ? [] : ["line\nname.txt", 'quote"name.txt']),
])(
  "recognizes squash patches with different blobs for %j",
  async (featurePath) => {
    const repo = await createDivergedRepo({ featurePath });
    await fs.writeFile(path.join(repo, featurePath), "feature\nsecond\n");
    await runGit(["add", "."], { cwd: repo });
    await runGit(["commit", "-m", "Second feature"], { cwd: repo });
    await runGit(["checkout", "main"], { cwd: repo });
    await fs.writeFile(path.join(repo, featurePath), "feature  \nsecond  \n");
    await runGit(["add", "."], { cwd: repo });
    await runGit(["commit", "-m", "Squashed with whitespace changes"], {
      cwd: repo,
    });
    await runGit(["checkout", "feature"], { cwd: repo });
    const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(status.mergeBase).toMatchObject({
      squashMergeCheckComplete: true,
      aheadCount: 0,
      commits: [],
      files: [],
    });
  },
);

it("proves exact squash integration without hashing even beyond the metadata limit", async () => {
  const repo = await createDivergedRepo();
  await fs.writeFile(path.join(repo, "feature.txt"), "feature\nsecond\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Second feature"], { cwd: repo });
  await advanceMain(repo, 1000);
  await runGit(["checkout", "main"], { cwd: repo });
  await runGit(["merge", "--squash", "feature"], { cwd: repo });
  await runGit(["commit", "-m", "Squashed feature"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });
  const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
    mergeBaseBranch: "main",
  });
  expect(status.mergeBase).toMatchObject({
    squashMergeCheckComplete: true,
    aheadCount: 0,
  });
  expect(
    vi
      .mocked(runGit)
      .mock.calls.some(
        ([args, options]) =>
          options.cwd === repo && args[0] === "patch-id" && options.signal,
      ),
  ).toBe(false);
});

it.each([
  "rename",
  "binary",
  ...(process.platform === "win32" ? [] : ["mode"]),
])("recognizes an exact squash containing a %s change", async (kind) => {
  const repo = await createDivergedRepo();
  if (kind === "rename") {
    await runGit(["mv", "README.md", "renamed readme.md"], { cwd: repo });
  } else if (kind === "binary") {
    await fs.writeFile(
      path.join(repo, "feature.txt"),
      Buffer.from([0, 1, 2, 255]),
    );
  } else {
    await fs.chmod(path.join(repo, "feature.txt"), 0o755);
  }
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Second feature change"], { cwd: repo });
  await runGit(["checkout", "main"], { cwd: repo });
  await runGit(["merge", "--squash", "feature"], { cwd: repo });
  await runGit(["commit", "-m", "Squashed feature"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });
  const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
    mergeBaseBranch: "main",
  });
  expect(status.mergeBase).toMatchObject({
    squashMergeCheckComplete: true,
    aheadCount: 0,
  });
});

it("finishes a timed-out squash check on the next refresh without rehashing commits", async () => {
  const repo = await createDivergedRepo();
  await fs.writeFile(path.join(repo, "feature.txt"), "feature\nsecond\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Second feature"], { cwd: repo });
  await runGit(["checkout", "main"], { cwd: repo });
  await fs.writeFile(path.join(repo, "feature.txt"), "feature  \nsecond  \n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Squashed feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "feature.txt"), "later change\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Later main change"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });
  const actual =
    await vi.importActual<typeof import("bb-environment-provider-host/workspace-git")>("bb-environment-provider-host/workspace-git");
  let interrupted = false;
  vi.mocked(runGit).mockImplementation((args, options) => {
    if (
      options.cwd === repo &&
      options.signal &&
      args[0] === "diff" &&
      !args.includes("--raw") &&
      !interrupted
    ) {
      interrupted = true;
      return new Promise((_, reject) => {
        const onAbort = () => reject(new Error("Interrupted branch patch"));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
      });
    }
    return actual.runGit(args, options);
  });
  const commitPatches = (renames: boolean) =>
    vi
      .mocked(runGit)
      .mock.calls.filter(
        ([args, options]) =>
          options.cwd === repo &&
          args[0] === "log" &&
          args.includes("-p") &&
          args.includes("--no-renames") !== renames,
      ).length;
  const read = () => new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  try {
    expect((await read()).mergeBase).toMatchObject({
      squashMergeCheckComplete: false,
      aheadCount: 2,
    });
    expect([commitPatches(false), commitPatches(true)]).toEqual([1, 0]);
    const [resumed, concurrent] = await Promise.all([read(), read()]);
    expect(resumed.mergeBase).toMatchObject({
      squashMergeCheckComplete: true,
      aheadCount: 0,
    });
    expect(concurrent.mergeBase).toEqual(resumed.mergeBase);
    expect([commitPatches(false), commitPatches(true)]).toEqual([1, 2]);
  } finally {
    vi.mocked(runGit).mockImplementation(actual.runGit);
  }
}, 15_000);

it("excludes cherry-picked commits on both sides but keeps same-file changes", async () => {
  const repo = await initRepo(await makeTempDir("bb-status-cherry-pick-"));
  await runGit(["checkout", "-b", "feature"], { cwd: repo });
  await fs.writeFile(path.join(repo, "picked.txt"), "picked\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Picked"], { cwd: repo });
  const picked = (
    await runGit(["rev-parse", "HEAD"], { cwd: repo })
  ).stdout.trim();
  await fs.writeFile(path.join(repo, "unique.txt"), "branch\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Unique"], { cwd: repo });
  await runGit(["checkout", "main"], { cwd: repo });
  await runGit(["cherry-pick", picked], { cwd: repo });
  await fs.writeFile(path.join(repo, "unique.txt"), "main\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Same file, different change"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });

  const status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(),
    mergeBaseBranch: "main",
  });

  expect(status.mergeBase).toMatchObject({ aheadCount: 1, behindCount: 1 });
  expect(status.mergeBase?.commits.map((commit) => commit.subject)).toEqual([
    "Unique",
  ]);
});

it("keeps renamed files compact when comparing squash patches", async () => {
  const repo = await initRepo(await makeTempDir("bb-status-squash-rename-"));
  const lines = Array.from({ length: 600_000 }, (_, i) => `line ${i}`);
  await fs.writeFile(path.join(repo, "big.txt"), `${lines.join("\n")}\n`);
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Big file"], { cwd: repo });
  await runGit(["checkout", "-b", "feature"], { cwd: repo });
  await runGit(["mv", "big.txt", "moved.txt"], { cwd: repo });
  await runGit(["commit", "-m", "Move"], { cwd: repo });
  lines[500] = "edited";
  await fs.writeFile(path.join(repo, "moved.txt"), `${lines.join("\n")}\n`);
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Edit"], { cwd: repo });
  await runGit(["checkout", "main"], { cwd: repo });
  await runGit(["mv", "big.txt", "moved.txt"], { cwd: repo });
  lines[500] = "edited  ";
  await fs.writeFile(path.join(repo, "moved.txt"), `${lines.join("\n")}\n`);
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Squashed with whitespace changes"], {
    cwd: repo,
  });
  await fs.writeFile(path.join(repo, "later.txt"), "later\n");
  await runGit(["add", "."], { cwd: repo });
  await runGit(["commit", "-m", "Later main change"], { cwd: repo });
  await runGit(["checkout", "feature"], { cwd: repo });

  let status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  for (
    let refresh = 0;
    refresh < 5 && !status.mergeBase?.squashMergeCheckComplete;
    refresh += 1
  ) {
    status = await new WorkspaceReads(repo, tmpdir()).getStatus({ freshness: fresh(), mergeBaseBranch: "main" });
  }

  expect(status.mergeBase).toMatchObject({
    squashMergeCheckComplete: true,
    aheadCount: 0,
  });
}, 60_000);
