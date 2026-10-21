import {
  execFileSync,
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
} from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectPublication, publishPublication } from "./publication.js";
import type { PublicationSnapshot } from "./publication-contract.js";

const calls = vi.hoisted(() => ({
  network: [] as Array<{
    file: string;
    args: string[];
    cwd: string | undefined;
    body: string | null;
  }>,
  existing: false,
  failures: [] as Array<{ args: string[]; error: string }>,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile(
      file: string,
      args: string[],
      options: ExecFileOptionsWithStringEncoding,
      callback: (
        error: ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) {
      if (file === "gh" || args.includes("push")) {
        const bodyIndex = args.indexOf("--body-file");
        calls.network.push({
          file,
          args,
          cwd: typeof options.cwd === "string" ? options.cwd : undefined,
          body:
            bodyIndex >= 0 ? readFileSync(args[bodyIndex + 1]!, "utf8") : null,
        });
        const output = args.includes("list")
          ? JSON.stringify(
              calls.existing
                ? [{ url: "https://github.com/acme/widgets/pull/7" }]
                : [],
            )
          : args.includes("create")
            ? "https://github.com/acme/widgets/pull/8\n"
            : "ok";
        callback(null, output, "");
        return;
      }
      return actual.execFile(file, args, options, (error, stdout, stderr) => {
        if (error)
          calls.failures.push({ args, error: stderr.trim() || error.message });
        callback(error, stdout, stderr);
      });
    },
  };
});

let root: string;
let checkout: string;
let tempDir: string;
let signal: AbortSignal;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, "empty-config"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

beforeEach(() => {
  calls.network = [];
  calls.failures = [];
  calls.existing = false;
  root = mkdtempSync(join(tmpdir(), "bb-publication-"));
  checkout = join(root, "checkout");
  tempDir = join(root, "host-temporary");
  mkdirSync(checkout);
  writeFileSync(join(root, "empty-config"), "");
  signal = new AbortController().signal;
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.com");
  writeFileSync(join(checkout, "file.txt"), "before\n");
  git("add", "file.txt");
  git("commit", "-m", "Initial fixture");
  git("remote", "add", "origin", "https://github.com/acme/widgets.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git("checkout", "-b", "automation/change");
  writeFileSync(join(checkout, "file.txt"), "after\n");
  git("add", "file.txt");
  git("commit", "-m", "Local result");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function snapshot(): Promise<PublicationSnapshot> {
  const result = await inspectPublication(
    { path: checkout, baseBranch: null },
    { tempDir, signal },
  );
  expect(result, JSON.stringify(calls.failures)).toMatchObject({
    status: "ready",
  });
  if (result.status !== "ready")
    throw new Error(`Unexpected inspection: ${result.reason}`);
  return result.snapshot;
}

it("inspects a clean committed result without networking or executing checkout configuration", async () => {
  const marker = join(root, "unsafe-command-ran");
  const script = join(root, "unsafe.cjs");
  writeFileSync(
    script,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unsafe")`,
  );
  git("config", "core.fsmonitor", `node ${JSON.stringify(script)}`);
  git("config", "diff.external", `node ${JSON.stringify(script)}`);
  const result = await snapshot();
  expect(result).toMatchObject({
    repo: "acme/widgets",
    branch: "automation/change",
    baseBranch: "main",
  });
  expect(result.commit).toBe(git("rev-parse", "HEAD"));
  expect(calls.network).toEqual([]);
  expect(existsSync(marker)).toBe(false);
});

it("rejects uncommitted work and a stale committed result before any network call", async () => {
  const previous = await snapshot();
  writeFileSync(join(checkout, "file.txt"), "later\n");
  await expect(
    inspectPublication(
      { path: checkout, baseBranch: "main" },
      { tempDir, signal },
    ),
  ).resolves.toEqual({ status: "unavailable", reason: "dirty_worktree" });
  await expect(
    publishPublication(
      {
        path: checkout,
        snapshot: previous,
        title: "Fix tests",
        body: "Local fixes",
      },
      { tempDir, signal },
    ),
  ).rejects.toThrow("Review it again");
  git("add", "file.txt");
  git("commit", "-m", "Changed after review");
  await expect(
    publishPublication(
      {
        path: checkout,
        snapshot: previous,
        title: "Fix tests",
        body: "Local fixes",
      },
      { tempDir, signal },
    ),
  ).rejects.toThrow("Review it again");
  expect(calls.network).toEqual([]);
});

it("rejects a staged change even when the working file matches the committed result", async () => {
  writeFileSync(join(checkout, "file.txt"), "staged\n");
  git("add", "file.txt");
  writeFileSync(join(checkout, "file.txt"), "after\n");
  await expect(
    inspectPublication(
      { path: checkout, baseBranch: "main" },
      { tempDir, signal },
    ),
  ).resolves.toEqual({ status: "unavailable", reason: "dirty_worktree" });
});

it("rejects default branches and non-GitHub remotes", async () => {
  git("checkout", "main");
  await expect(
    inspectPublication(
      { path: checkout, baseBranch: null },
      { tempDir, signal },
    ),
  ).resolves.toEqual({ status: "unavailable", reason: "default_branch" });
  git("checkout", "automation/change");
  git(
    "remote",
    "set-url",
    "origin",
    "https://github.com.attacker.example/acme/widgets.git",
  );
  await expect(
    inspectPublication(
      { path: checkout, baseBranch: null },
      { tempDir, signal },
    ),
  ).resolves.toEqual({
    status: "unavailable",
    reason: "repository_unavailable",
  });
  expect(calls.network).toEqual([]);
});

it("publishes only the reviewed SHA from a fresh transport repository and creates a draft", async () => {
  const selected = await snapshot();
  const body = "Fix failures.\n\n> AGENT GENERATED";
  await expect(
    publishPublication(
      { path: checkout, snapshot: selected, title: "Fix tests", body },
      { tempDir, signal },
    ),
  ).resolves.toEqual({ url: "https://github.com/acme/widgets/pull/8" });
  const push = calls.network.find((call) => call.file === "git");
  expect(push?.args).toEqual(
    expect.arrayContaining([
      "push",
      "--porcelain",
      "https://github.com/acme/widgets.git",
      `${selected.commit}:refs/heads/automation/change`,
    ]),
  );
  expect(push?.args).not.toContain("--force");
  expect(push?.args[1]).not.toBe(checkout);
  const create = calls.network.find((call) => call.args.includes("create"));
  expect(create?.args).toEqual(
    expect.arrayContaining([
      "--draft",
      "--head",
      "automation/change",
      "--base",
      "main",
    ]),
  );
  expect(create?.body).toBe(body);
});

it("returns an existing pull request when a previous publication is retried", async () => {
  calls.existing = true;
  await expect(
    publishPublication(
      {
        path: checkout,
        snapshot: await snapshot(),
        title: "Fix tests",
        body: "Fix failures",
      },
      { tempDir, signal },
    ),
  ).resolves.toEqual({ url: "https://github.com/acme/widgets/pull/7" });
  expect(calls.network.some((call) => call.args.includes("create"))).toBe(
    false,
  );
});
