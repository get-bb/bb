import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeGh, makeTempDir } from "../test/fake-gh.js";
import {
  parseActionsJobUrl,
  readCheckLogs,
  rerunChecks,
  tailCheckLog,
} from "./checks.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const PR_URL = "https://github.com/acme/bb/pull/42";

function job(name: string, run: number, jobId: number, conclusion: string) {
  return {
    name,
    status: "COMPLETED",
    conclusion,
    detailsUrl: `https://github.com/acme/bb/actions/runs/${run}/job/${jobId}`,
    startedAt: "2026-11-20T00:00:00Z",
  };
}

function pullRequest(contexts: object[]) {
  return {
    number: 42,
    title: "Fix it",
    state: "OPEN",
    url: PR_URL,
    isDraft: false,
    autoMergeRequest: null,
    isInMergeQueue: false,
    baseRefName: "main",
    headRefName: "bb/fix",
    headRefOid: "a".repeat(40),
    updatedAt: "2026-11-20T00:00:00Z",
    reviewDecision: null,
    reviewRequests: { totalCount: 0 },
    mergeStateStatus: "UNSTABLE",
    mergeable: "MERGEABLE",
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: contexts,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      ],
    },
  };
}

const CONTEXTS = [
  job("lint", 5, 51, "FAILURE"),
  job("test", 5, 52, "FAILURE"),
  job("build", 6, 61, "SUCCESS"),
  {
    context: "ci/external",
    state: "FAILURE",
    targetUrl: "https://ci.example.test/build/42",
    createdAt: "2026-11-20T00:00:00Z",
  },
];

async function fakeGh(logs = "") {
  return installFakeGh({
    "api graphql": {
      resources: { [PR_URL]: { data: pullRequest(CONTEXTS) } },
    },
    "api --hostname": { stdout: logs },
    "run rerun": {},
  });
}

describe("tailCheckLog", () => {
  it("drops timestamps and the post-job steps after the last error, then keeps the last lines", () => {
    const log = [
      "2026-11-20T00:00:01.0000000Z ##[group]Run pnpm test",
      "2026-11-20T00:00:02.0000000Z \u001b[31mFAIL\u001b[0m src/a.test.ts",
      "2026-11-20T00:00:03.0000000Z expected 1 to be 2",
      "2026-11-20T00:00:04.0000000Z ##[error]Process completed with exit code 1.",
      "2026-11-20T00:00:05.0000000Z Post job cleanup.",
      "",
    ].join("\r\n");
    expect(tailCheckLog(log, 3)).toBe(
      [
        "FAIL src/a.test.ts",
        "expected 1 to be 2",
        "##[error]Process completed with exit code 1.",
      ].join("\n"),
    );
  });

  it("keeps the end of a log without an error marker", () => {
    expect(tailCheckLog("one\ntwo\nthree\n\n", 2)).toBe("two\nthree");
  });
});

describe("parseActionsJobUrl", () => {
  it("reads the repository, run and job from an Actions job link", () => {
    expect(
      parseActionsJobUrl(
        "https://ghe.example.test/acme/bb/actions/runs/5/job/51?pr=42",
      ),
    ).toEqual({
      host: "ghe.example.test",
      repository: "acme/bb",
      runId: "5",
      jobId: "51",
    });
  });

  it.each([
    null,
    "https://ci.example.test/build/42",
    "https://github.com/acme/bb/actions/runs/5",
  ])("returns null for %s", (url) => {
    expect(parseActionsJobUrl(url)).toBeNull();
  });
});

describe("readCheckLogs", () => {
  it("reads each failing Actions job's log and links checks from other CI services", async () => {
    const gh = await fakeGh("step\n##[error]boom\nPost job cleanup.");
    const cwd = await makeTempDir("bb-check-logs-");
    await expect(
      readCheckLogs({ cwd, url: PR_URL, check: null, lines: 10 }),
    ).resolves.toEqual({
      ok: true,
      checks: [
        {
          name: "lint",
          url: "https://github.com/acme/bb/actions/runs/5/job/51",
          log: "step\n##[error]boom",
          note: null,
        },
        {
          name: "test",
          url: "https://github.com/acme/bb/actions/runs/5/job/52",
          log: "step\n##[error]boom",
          note: null,
        },
        {
          name: "ci/external",
          url: "https://ci.example.test/build/42",
          log: null,
          note: "Not a GitHub Actions job of this pull request's repository, so its log can't be read here. Open its link.",
        },
      ],
    });
    expect(
      (await gh.readCalls())
        .filter((call) => call[1] === "--hostname")
        .sort((left, right) => left[3]!.localeCompare(right[3]!)),
    ).toEqual([
      ["api", "--hostname", "github.com", "repos/acme/bb/actions/jobs/51/logs"],
      ["api", "--hostname", "github.com", "repos/acme/bb/actions/jobs/52/logs"],
    ]);
  });

  it("passes --allow-escape-sequences when gh refuses a log with escape codes", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        resources: { [PR_URL]: { data: pullRequest([CONTEXTS[0]!]) } },
      },
      "api --hostname": {
        exit: 1,
        stderr:
          "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway",
      },
      "api --allow-escape-sequences": {
        stdout: "\u001b[31mFAIL\u001b[0m a.test.ts\n##[error]boom\n",
      },
    });
    const cwd = await makeTempDir("bb-check-logs-");
    await expect(
      readCheckLogs({ cwd, url: PR_URL, check: null, lines: 10 }),
    ).resolves.toMatchObject({
      ok: true,
      checks: [
        { name: "lint", log: "FAIL a.test.ts\n##[error]boom", note: null },
      ],
    });
    expect(
      (await gh.readCalls()).filter(
        (call) => call[0] === "api" && call[1] !== "graphql",
      ),
    ).toEqual([
      ["api", "--hostname", "github.com", "repos/acme/bb/actions/jobs/51/logs"],
      [
        "api",
        "--allow-escape-sequences",
        "--hostname",
        "github.com",
        "repos/acme/bb/actions/jobs/51/logs",
      ],
    ]);
  });

  it("names the checks when the requested one does not exist", async () => {
    await fakeGh();
    const cwd = await makeTempDir("bb-check-logs-");
    await expect(
      readCheckLogs({ cwd, url: PR_URL, check: "deploy", lines: 10 }),
    ).resolves.toEqual({
      ok: false,
      message: "No check named deploy. Checks: lint, test, build, ci/external",
    });
  });
});

describe("check selection", () => {
  it("uses only the latest run of each check and skips jobs in another repository", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        resources: {
          [PR_URL]: {
            data: pullRequest([
              {
                ...job("test", 5, 52, "FAILURE"),
                startedAt: "2026-11-20T00:00:00Z",
              },
              {
                ...job("test", 7, 72, "SUCCESS"),
                startedAt: "2026-11-20T00:10:00Z",
              },
              {
                ...job("lint", 8, 81, "FAILURE"),
                detailsUrl:
                  "https://github.com/other/repo/actions/runs/8/job/81",
              },
            ]),
          },
        },
      },
      "api --hostname": { stdout: "log" },
      "run rerun": {},
    });
    const cwd = await makeTempDir("bb-check-select-");
    await expect(
      readCheckLogs({ cwd, url: PR_URL, check: null, lines: 10 }),
    ).resolves.toEqual({
      ok: true,
      checks: [
        {
          name: "lint",
          url: "https://github.com/other/repo/actions/runs/8/job/81",
          log: null,
          note: "Not a GitHub Actions job of this pull request's repository, so its log can't be read here. Open its link.",
        },
      ],
    });
    await expect(
      rerunChecks({ cwd, url: PR_URL, check: "test" }),
    ).resolves.toEqual({ ok: true, message: "Re-running test" });
    const calls = await gh.readCalls();
    expect(calls.filter((call) => call[1] === "--hostname")).toEqual([]);
    expect(calls.filter((call) => call[0] === "run")).toEqual([
      ["run", "rerun", "--job", "72", "-R", "github.com/acme/bb"],
    ]);
  });
});

describe("rerunChecks", () => {
  it("re-runs the failed jobs of each workflow run once", async () => {
    const gh = await fakeGh();
    const cwd = await makeTempDir("bb-rerun-");
    await expect(
      rerunChecks({ cwd, url: PR_URL, check: null }),
    ).resolves.toEqual({
      ok: true,
      message: [
        "Re-running the failed jobs of 1 workflow run(s)",
        "Not GitHub Actions jobs of this repository, not re-run: ci/external",
      ].join("\n"),
    });
    expect((await gh.readCalls()).filter((call) => call[0] === "run")).toEqual([
      ["run", "rerun", "5", "--failed", "-R", "github.com/acme/bb"],
    ]);
  });

  it("re-runs only the named check's job, even when it passed", async () => {
    const gh = await fakeGh();
    const cwd = await makeTempDir("bb-rerun-");
    await expect(
      rerunChecks({ cwd, url: PR_URL, check: "build" }),
    ).resolves.toEqual({ ok: true, message: "Re-running build" });
    expect((await gh.readCalls()).filter((call) => call[0] === "run")).toEqual([
      ["run", "rerun", "--job", "61", "-R", "github.com/acme/bb"],
    ]);
  });

  it("refuses when no failing check is an Actions job", async () => {
    await installFakeGh({
      "api graphql": {
        resources: { [PR_URL]: { data: pullRequest([CONTEXTS[3]!]) } },
      },
    });
    const cwd = await makeTempDir("bb-rerun-");
    await expect(
      rerunChecks({ cwd, url: PR_URL, check: null }),
    ).resolves.toEqual({
      ok: false,
      message:
        "None of these checks is a GitHub Actions job of this pull request's repository, so bb can't re-run them: ci/external",
    });
  });
});
