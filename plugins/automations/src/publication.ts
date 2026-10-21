import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { experimental_runVcsProcess as runVcsProcess } from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import {
  publicationSnapshotSchema,
  type PublicationSnapshot,
  type publicationInspectionSchema,
} from "./publication-contract.js";

interface PublicationContext {
  tempDir: string;
  signal: AbortSignal;
}

function processEnvironment(
  configPath: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: configPath,
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
    GH_HOST: "github.com",
    ...extra,
  };
}

async function run(
  file: "git" | "gh",
  args: string[],
  context: PublicationContext,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  await mkdir(context.tempDir, { recursive: true });
  const configPath = join(context.tempDir, "empty-gitconfig");
  await writeFile(configPath, "");
  return runVcsProcess(
    file,
    args,
    () =>
      new Promise<string>((resolve, reject) => {
        execFile(
          file,
          args,
          {
            cwd: options.cwd,
            env: processEnvironment(configPath, options.env),
            signal: context.signal,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message));
            else resolve(stdout.trim());
          },
        );
      }),
    { signal: context.signal, priority: "interactive" },
  );
}

function sourceGit(
  path: string,
  args: string[],
  context: PublicationContext,
): Promise<string> {
  return run(
    "git",
    [
      "-C",
      path,
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.hooksPath=${join(context.tempDir, "disabled-hooks")}`,
      ...args,
    ],
    context,
  );
}

function githubRepo(remote: string): string | null {
  const match = remote.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
  );
  return match?.[1] ?? null;
}

async function resolveBaseBranch(
  path: string,
  requested: string | null,
  context: PublicationContext,
): Promise<string | null> {
  if (requested !== null) {
    await sourceGit(path, ["check-ref-format", "--branch", requested], context);
    return requested;
  }
  try {
    const ref = await sourceGit(
      path,
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      context,
    );
    if (ref.startsWith("refs/remotes/origin/"))
      return ref.slice("refs/remotes/origin/".length);
  } catch {}
  for (const name of ["main", "master"]) {
    try {
      await sourceGit(
        path,
        ["rev-parse", "--verify", `refs/remotes/origin/${name}^{commit}`],
        context,
      );
      return name;
    } catch {}
  }
  return null;
}

async function withTransportRepository<T>(
  path: string,
  snapshot: PublicationSnapshot,
  context: PublicationContext,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const objects = await sourceGit(
    path,
    ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
    context,
  );
  await mkdir(context.tempDir, { recursive: true });
  const directory = await mkdtemp(join(context.tempDir, "publication-"));
  try {
    await run("git", ["init", "--bare", "--template=", directory], context);
    await writeFile(
      join(directory, "objects", "info", "alternates"),
      `${JSON.stringify(objects)}\n`,
    );
    await run(
      "git",
      [
        "--git-dir",
        directory,
        "update-ref",
        `refs/heads/${snapshot.branch}`,
        snapshot.commit,
      ],
      context,
    );
    await run(
      "git",
      [
        "--git-dir",
        directory,
        "symbolic-ref",
        "HEAD",
        `refs/heads/${snapshot.branch}`,
      ],
      context,
    );
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectPublication(
  input: { path: string; baseBranch: string | null },
  context: PublicationContext,
): Promise<z.infer<typeof publicationInspectionSchema>> {
  context.signal.throwIfAborted();
  try {
    const repo = githubRepo(
      await sourceGit(input.path, ["remote", "get-url", "origin"], context),
    );
    if (repo === null)
      return { status: "unavailable", reason: "repository_unavailable" };
    let branch: string;
    try {
      branch = await sourceGit(
        input.path,
        ["symbolic-ref", "--short", "HEAD"],
        context,
      );
      await sourceGit(
        input.path,
        ["check-ref-format", "--branch", branch],
        context,
      );
    } catch {
      return { status: "unavailable", reason: "detached_head" };
    }
    const baseBranch = await resolveBaseBranch(
      input.path,
      input.baseBranch,
      context,
    );
    if (baseBranch === null)
      return { status: "unavailable", reason: "base_unavailable" };
    if (branch === baseBranch || branch === "main" || branch === "master")
      return { status: "unavailable", reason: "default_branch" };
    let baseCommit: string;
    try {
      baseCommit = await sourceGit(
        input.path,
        ["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}^{commit}`],
        context,
      );
    } catch {
      return { status: "unavailable", reason: "base_unavailable" };
    }
    const commit = await sourceGit(
      input.path,
      ["rev-parse", "--verify", "HEAD^{commit}"],
      context,
    );
    const snapshot = publicationSnapshotSchema.parse({
      repo,
      branch,
      commit,
      baseBranch,
      baseCommit,
    });
    return await withTransportRepository<
      z.infer<typeof publicationInspectionSchema>
    >(input.path, snapshot, context, async (directory) => {
      const git = (args: string[], env?: NodeJS.ProcessEnv) =>
        run(
          "git",
          [
            "--git-dir",
            directory,
            "--work-tree",
            input.path,
            "-c",
            "core.bare=false",
            ...args,
          ],
          context,
          { env },
        );
      const changes = await git([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-only",
        `${baseCommit}...${commit}`,
      ]);
      if (changes.length === 0)
        return { status: "unavailable", reason: "no_changes" };
      await git(["read-tree", commit]);
      const status = await git([
        "status",
        "--porcelain",
        "--untracked-files=normal",
      ]);
      const index = await sourceGit(
        input.path,
        ["rev-parse", "--path-format=absolute", "--git-path", "index"],
        context,
      );
      const staged = await git(
        [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--name-only",
          commit,
        ],
        { GIT_INDEX_FILE: index },
      );
      if (status.length > 0 || staged.length > 0)
        return { status: "unavailable", reason: "dirty_worktree" };
      return { status: "ready", snapshot };
    });
  } catch (error) {
    if (context.signal.aborted) throw error;
    return { status: "unavailable", reason: "repository_unavailable" };
  }
}

export async function publishPublication(
  input: {
    path: string;
    snapshot: PublicationSnapshot;
    title: string;
    body: string;
  },
  context: PublicationContext,
): Promise<{ url: string }> {
  const current = await inspectPublication(
    { path: input.path, baseBranch: input.snapshot.baseBranch },
    context,
  );
  if (
    current.status !== "ready" ||
    current.snapshot.repo !== input.snapshot.repo ||
    current.snapshot.branch !== input.snapshot.branch ||
    current.snapshot.commit !== input.snapshot.commit ||
    current.snapshot.baseBranch !== input.snapshot.baseBranch ||
    current.snapshot.baseCommit !== input.snapshot.baseCommit
  ) {
    throw new Error(
      "The local result changed. Review it again before publishing.",
    );
  }
  return await withTransportRepository(
    input.path,
    input.snapshot,
    context,
    async (directory) => {
      await run(
        "gh",
        ["auth", "status", "--hostname", "github.com", "--active"],
        context,
        { cwd: directory },
      );
      await run(
        "git",
        [
          "--git-dir",
          directory,
          "-c",
          "credential.helper=",
          "-c",
          "credential.https://github.com.helper=!gh auth git-credential",
          "-c",
          "push.followTags=false",
          "push",
          "--porcelain",
          `https://github.com/${input.snapshot.repo}.git`,
          `${input.snapshot.commit}:refs/heads/${input.snapshot.branch}`,
        ],
        context,
      );
      const existing = z
        .array(z.object({ url: z.string().url() }))
        .parse(
          JSON.parse(
            await run(
              "gh",
              [
                "pr",
                "list",
                "--repo",
                input.snapshot.repo,
                "--head",
                input.snapshot.branch,
                "--base",
                input.snapshot.baseBranch,
                "--state",
                "open",
                "--limit",
                "1",
                "--json",
                "url",
              ],
              context,
              { cwd: directory },
            ),
          ),
        );
      if (existing[0] !== undefined) return existing[0];
      const bodyFile = join(directory, "pull-request-body.md");
      await writeFile(bodyFile, input.body);
      const output = await run(
        "gh",
        [
          "pr",
          "create",
          "--repo",
          input.snapshot.repo,
          "--draft",
          "--head",
          input.snapshot.branch,
          "--base",
          input.snapshot.baseBranch,
          "--title",
          input.title,
          "--body-file",
          bodyFile,
        ],
        context,
        { cwd: directory },
      );
      const url = output
        .split(/\r?\n/)
        .reverse()
        .find((line) =>
          /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(line),
        );
      if (url === undefined)
        throw new Error(
          "The branch was pushed, but GitHub did not return a pull request URL. Retry publishing to look it up.",
        );
      return { url };
    },
  );
}
