import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JsonValue } from "@bb/domain";
import {
  getPullRequestForCurrentBranch,
  parseGitHostPullRequest,
  runPullRequestActionForCurrentBranch,
  type GitHostPullRequestAction,
} from "../src/git-host.js";

interface FakeGhError extends Error {
  code?: number | string | null;
  killed?: boolean;
  stderr?: string;
}

let commandDir: string;
let ghPath: string;

function testShellPath(): string {
  return [commandDir, dirname(process.execPath), "/usr/bin", "/bin"].join(
    delimiter,
  );
}

const gitScript = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
appendFileSync(join(dirname(process.argv[1]), "git-log"), process.argv.slice(2).join("\\t") + "\\n");
`;

const ghScript = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const directory = dirname(process.argv[1]);
appendFileSync(join(directory, "gh-log"), process.argv.slice(2).join("\\t") + "\\n");
const mode = readFileSync(join(directory, "gh-mode"), "utf8").trim();
if (mode === "timeout") {
  setInterval(() => {}, 1_000);
} else if (mode === "error") {
  process.stderr.write(readFileSync(join(directory, "gh-error"), "utf8"));
  process.exit(Number(readFileSync(join(directory, "gh-code"), "utf8")));
} else if (mode === "invalid") {
  process.stdout.write("not json at all");
} else {
  process.stdout.write(readFileSync(join(directory, "gh-output"), "utf8"));
}
`;

beforeAll(() => {
  commandDir = mkdtempSync(join(tmpdir(), "bb-git-host-test-"));
  ghPath = join(commandDir, "gh");
  writeFileSync(join(commandDir, "git"), gitScript);
  writeFileSync(ghPath, ghScript);
  chmodSync(join(commandDir, "git"), 0o755);
  chmodSync(ghPath, 0o755);
});

beforeEach(() => {
  writeFileSync(ghPath, ghScript);
  chmodSync(ghPath, 0o755);
  writeFileSync(join(commandDir, "gh-log"), "");
  writeFileSync(join(commandDir, "gh-mode"), "success");
  writeFileSync(join(commandDir, "gh-output"), ghJson());
  writeFileSync(join(commandDir, "gh-error"), "");
  writeFileSync(join(commandDir, "gh-code"), "1");
});

afterAll(() => {
  rmSync(commandDir, { recursive: true, force: true });
});

function ghJson(overrides: Record<string, JsonValue> = {}): string {
  return JSON.stringify({
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/add-pr-section",
    updatedAt: "2026-06-16T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  });
}

function ghCalls(): string[][] {
  const log = readFileSync(join(commandDir, "gh-log"), "utf8").trim();
  return log === "" ? [] : log.split("\n").map((line) => line.split("\t"));
}

function setGhStdout(stdout: string): void {
  writeFileSync(join(commandDir, "gh-mode"), "success");
  writeFileSync(join(commandDir, "gh-output"), stdout);
}

function setGhFailure(error: FakeGhError): void {
  if (error.killed === true) {
    writeFileSync(join(commandDir, "gh-mode"), "timeout");
    return;
  }
  writeFileSync(join(commandDir, "gh-mode"), "error");
  writeFileSync(join(commandDir, "gh-error"), error.stderr ?? "");
  writeFileSync(join(commandDir, "gh-code"), String(error.code ?? 1));
}

describe("parseGitHostPullRequest", () => {
  it("parses a well-formed open PR", () => {
    expect(parseGitHostPullRequest(ghJson())).toEqual({
      number: 42,
      title: "Add pull request section",
      state: "OPEN",
      url: "https://github.com/acme/bb/pull/42",
      isDraft: false,
      baseRefName: "main",
      headRefName: "bb/add-pr-section",
      updatedAt: "2026-06-16T12:30:00Z",
      checks: [],
      reviewDecision: null,
      reviewRequestCount: 0,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    });
  });

  it("preserves the draft flag and merged/closed states", () => {
    expect(parseGitHostPullRequest(ghJson({ isDraft: true }))?.isDraft).toBe(
      true,
    );
    expect(parseGitHostPullRequest(ghJson({ state: "MERGED" }))?.state).toBe(
      "MERGED",
    );
    expect(parseGitHostPullRequest(ghJson({ state: "CLOSED" }))?.state).toBe(
      "CLOSED",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseGitHostPullRequest(`\n  ${ghJson()}\n`)?.number).toBe(42);
  });

  it("normalizes checks, review requests, and mergeability", () => {
    expect(
      parseGitHostPullRequest(
        ghJson({
          statusCheckRollup: [
            {
              __typename: "CheckRun",
              name: "typecheck",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              detailsUrl: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:20:00Z",
            },
            {
              __typename: "StatusContext",
              context: "ci/build",
              state: "FAILURE",
              targetUrl: "https://ci.example.test/build/42",
              createdAt: "2026-06-16T12:21:00Z",
            },
            {
              __typename: "CheckRun",
              workflowName: "lint",
              status: "IN_PROGRESS",
              conclusion: null,
              startedAt: "2026-06-16T12:22:00Z",
            },
          ],
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: [
            { requestedReviewer: { login: "octocat" } },
            { requestedReviewer: { login: "hubot" } },
          ],
          mergeStateStatus: "DIRTY",
          mergeable: "CONFLICTING",
        }),
      ),
    ).toMatchObject({
      checks: [
        {
          name: "typecheck",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/acme/bb/actions/runs/1",
          startedAt: "2026-06-16T12:20:00Z",
        },
        {
          name: "ci/build",
          status: "completed",
          conclusion: "failure",
          url: "https://ci.example.test/build/42",
          startedAt: "2026-06-16T12:21:00Z",
        },
        {
          name: "lint",
          status: "in_progress",
          conclusion: null,
          url: null,
          startedAt: "2026-06-16T12:22:00Z",
        },
      ],
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequestCount: 2,
      mergeStateStatus: "DIRTY",
      mergeable: "CONFLICTING",
    });
  });

  it.each([
    ["empty output", ""],
    ["whitespace only", "   \n"],
    ["non-JSON", "no pull requests found for branch"],
    ["a JSON array", "[]"],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });

  it.each([
    ["an unknown state", ghJson({ state: "QUEUED" })],
    [
      "a missing field",
      JSON.stringify({ number: 1, title: "x", state: "OPEN" }),
    ],
    ["a non-positive number", ghJson({ number: 0 })],
    ["an invalid updatedAt", ghJson({ updatedAt: "yesterday" })],
    ["a non-url", ghJson({ url: "not-a-url" })],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });
});

describe("runPullRequestActionForCurrentBranch", () => {
  const actionArgs = {
    get cwd(): string {
      return commandDir;
    },
    localBranch: "bb/pr-action",
    get shellPath(): string {
      return testShellPath();
    },
  };

  function mockGhSuccess(): void {
    setGhStdout("");
  }

  it.each([
    ["ready", { operation: "ready" }, ["pr", "ready"]],
    ["draft", { operation: "draft" }, ["pr", "ready", "--undo"]],
    [
      "merge",
      { operation: "merge", method: "merge" },
      ["pr", "merge", "--merge"],
    ],
    [
      "squash",
      { operation: "merge", method: "squash" },
      ["pr", "merge", "--squash"],
    ],
    [
      "rebase",
      { operation: "merge", method: "rebase" },
      ["pr", "merge", "--rebase"],
    ],
  ] satisfies readonly [string, GitHostPullRequestAction, readonly string[]][])(
    "runs gh pr %s without a target so gh can honor a fork upstream",
    async (_label, action, expectedArgs) => {
      mockGhSuccess();

      await runPullRequestActionForCurrentBranch({
        ...actionArgs,
        action,
      });

      expect(ghCalls()).toContainEqual(expectedArgs);
    },
  );

  it("maps a missing gh executable to a workspace error", async () => {
    rmSync(ghPath);

    await expect(
      runPullRequestActionForCurrentBranch({
        ...actionArgs,
        shellPath: commandDir,
        action: { operation: "ready" },
      }),
    ).rejects.toMatchObject({
      code: "git_host_cli_unavailable",
      name: "WorkspaceError",
    });
  });
});

describe("getPullRequestForCurrentBranch", () => {
  const lookupArgs = {
    get cwd(): string {
      return commandDir;
    },
    localBranch: "bb/pr-lookup",
    get shellPath(): string {
      return testShellPath();
    },
  };

  function mockGhStdout(stdout: string): void {
    setGhStdout(stdout);
  }

  function mockGhFailure(error: FakeGhError): void {
    setGhFailure(error);
  }

  it("uses bare gh lookup when the branch has no differently named upstream", async () => {
    mockGhStdout(ghJson());
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 42, state: "OPEN" },
    });
    expect(ghCalls()[0]?.slice(0, 3)).toEqual(["pr", "view", "--json"]);
    expect(ghCalls()[0]?.[3]).toContain("number");
  });

  it("returns none when gh reports the branch has no PR", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 1"), {
        code: 1,
        stderr: 'no pull requests found for branch "bb/pr-lookup"',
      }),
    );
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "none",
    });
  });

  it("returns unavailable when gh is not installed", async () => {
    rmSync(ghPath);
    await expect(
      getPullRequestForCurrentBranch({
        ...lookupArgs,
        shellPath: commandDir,
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      message: "GitHub CLI is not available",
    });
  });

  it("returns unavailable with the stderr detail for an auth failure", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 4"), {
        code: 4,
        stderr: "gh: To get started with GitHub CLI, please run: gh auth login",
      }),
    );
    const result = await getPullRequestForCurrentBranch(lookupArgs);
    expect(result.outcome).toBe("unavailable");
    expect(result).toMatchObject({
      message: expect.stringContaining("gh auth login"),
    });
  });

  it("returns unavailable when gh times out", async () => {
    mockGhFailure(
      Object.assign(new Error("timed out"), { killed: true, code: null }),
    );
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      message: expect.stringContaining("timed out"),
    });
  });

  it("returns unavailable for unparseable gh output", async () => {
    mockGhStdout("not json at all");
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    });
  });
});
