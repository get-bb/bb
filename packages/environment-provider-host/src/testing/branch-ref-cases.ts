import { runGit } from "../workspace-git.js";

export type BranchRefCommit = "base" | "ahead" | "diverged";

export interface BranchRefCase {
  name: string;
  requested: string;
  local: BranchRefCommit | null;
  origin: BranchRefCommit | null;
  expected: { ref: string; commit: BranchRefCommit | null };
}

export interface BranchRefFixture {
  path: string;
  commits: Record<BranchRefCommit | "root", string>;
  expectedCommit: string | null;
}

export const BRANCH_REF_NAME = "release";
export const BRANCH_REF_CURRENT_BRANCH = "main";

const ORIGIN_NAME = `origin/${BRANCH_REF_NAME}`;

export const BRANCH_REF_CASES: readonly BranchRefCase[] = [
  {
    name: "local only",
    requested: BRANCH_REF_NAME,
    local: "base",
    origin: null,
    expected: { ref: BRANCH_REF_NAME, commit: "base" },
  },
  {
    name: "origin only",
    requested: BRANCH_REF_NAME,
    local: null,
    origin: "base",
    expected: { ref: ORIGIN_NAME, commit: "base" },
  },
  {
    name: "local equals origin",
    requested: BRANCH_REF_NAME,
    local: "base",
    origin: "base",
    expected: { ref: ORIGIN_NAME, commit: "base" },
  },
  {
    name: "local behind origin",
    requested: BRANCH_REF_NAME,
    local: "base",
    origin: "ahead",
    expected: { ref: ORIGIN_NAME, commit: "ahead" },
  },
  {
    name: "local ahead of origin",
    requested: BRANCH_REF_NAME,
    local: "ahead",
    origin: "base",
    expected: { ref: BRANCH_REF_NAME, commit: "ahead" },
  },
  {
    name: "local diverged from origin",
    requested: BRANCH_REF_NAME,
    local: "ahead",
    origin: "diverged",
    expected: { ref: BRANCH_REF_NAME, commit: "ahead" },
  },
  {
    name: "remote-qualified name",
    requested: ORIGIN_NAME,
    local: "ahead",
    origin: "base",
    expected: { ref: ORIGIN_NAME, commit: "base" },
  },
  {
    name: "full local ref",
    requested: `refs/heads/${BRANCH_REF_NAME}`,
    local: "base",
    origin: "ahead",
    expected: { ref: `refs/heads/${BRANCH_REF_NAME}`, commit: "base" },
  },
  {
    name: "missing everywhere",
    requested: BRANCH_REF_NAME,
    local: null,
    origin: null,
    expected: { ref: BRANCH_REF_NAME, commit: null },
  },
];

export const DEFAULT_BRANCH_REF_CASES: readonly BranchRefCase[] =
  BRANCH_REF_CASES.filter(
    (testCase) =>
      testCase.requested === BRANCH_REF_NAME && testCase.origin !== null,
  );

async function git(cwd: string, args: string[], input?: string) {
  const result = await runGit(
    [
      "-c",
      "user.name=bb",
      "-c",
      "user.email=bb@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, ...(input === undefined ? {} : { input }) },
  );
  return result.stdout.trim();
}

export async function createBranchRefFixture(
  repoPath: string,
  testCase: BranchRefCase,
  options: { originHead: boolean } = { originHead: false },
): Promise<BranchRefFixture> {
  await git(repoPath, ["init", "-q", "-b", BRANCH_REF_CURRENT_BRANCH]);
  const tree = await git(repoPath, ["mktree"], "");
  const commit = (message: string, parent?: string) =>
    git(repoPath, [
      "commit-tree",
      tree,
      ...(parent === undefined ? [] : ["-p", parent]),
      "-m",
      message,
    ]);
  const root = await commit("root");
  const base = await commit("base", root);
  const commits = {
    root,
    base,
    ahead: await commit("ahead", base),
    diverged: await commit("diverged", base),
  };
  await git(repoPath, [
    "update-ref",
    `refs/heads/${BRANCH_REF_CURRENT_BRANCH}`,
    root,
  ]);
  await git(repoPath, ["reset", "-q", "--hard", root]);
  if (testCase.local !== null) {
    await git(repoPath, [
      "update-ref",
      `refs/heads/${BRANCH_REF_NAME}`,
      commits[testCase.local],
    ]);
  }
  if (testCase.origin !== null) {
    await git(repoPath, [
      "update-ref",
      `refs/remotes/${ORIGIN_NAME}`,
      commits[testCase.origin],
    ]);
  }
  if (testCase.origin !== null && options.originHead) {
    await git(repoPath, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      `refs/remotes/${ORIGIN_NAME}`,
    ]);
  }
  return {
    path: repoPath,
    commits,
    expectedCommit:
      testCase.expected.commit === null
        ? null
        : commits[testCase.expected.commit],
  };
}
