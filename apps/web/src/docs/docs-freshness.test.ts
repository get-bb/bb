import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../scripts/docs-freshness.mjs");

let repo: string | null = null;

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = null;
});

function git(args: string[], date?: string) {
  execFileSync("git", ["-C", repo!, "-c", "commit.gpgsign=false", ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.test",
      ...(date
        ? {
            GIT_AUTHOR_DATE: `${date}T12:00:00Z`,
            GIT_COMMITTER_DATE: `${date}T12:00:00Z`,
          }
        : {}),
    },
  });
}

function write(file: string, contents: string) {
  const full = path.join(repo!, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function page(sources: string[], verified: string) {
  return [
    "---",
    "title: Choose a mode",
    "description: Pick one.",
    "type: how-to",
    "sources:",
    ...sources.map((source) => `  - ${source}`),
    "since: unreleased",
    "owner: octocat",
    `verified: ${verified}`,
    "---",
    "",
  ].join("\n");
}

function commit(date: string) {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", date], date);
}

function run() {
  const result = spawnSync(process.execPath, [SCRIPT, repo!], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
  });
  return { status: result.status, lines: result.stdout.trim().split("\n") };
}

describe("docs freshness check", () => {
  it("warns about a page whose sources changed after verified, naming the owner", () => {
    repo = mkdtempSync(path.join(tmpdir(), "docs-freshness-"));
    git(["init", "-q"]);
    write("apps/app/src/composer/mode.ts", "export const a = 1;\n");
    write("apps/app/src/other.ts", "export const b = 1;\n");
    write(
      "apps/web/content/docs/modes.mdx",
      page(["apps/app/src/composer/**"], "2026-05-02"),
    );
    commit("2026-05-01");
    write("apps/app/src/other.ts", "export const b = 2;\n");
    commit("2026-06-01");

    expect(run()).toEqual({
      status: 0,
      lines: ["1 docs pages checked, 0 out of date."],
    });

    write("apps/app/src/composer/mode.ts", "export const a = 2;\n");
    commit("2026-06-02");

    expect(run()).toEqual({
      status: 0,
      lines: [
        '::warning file=apps/web/content/docs/modes.mdx,title=Docs page may be out of date::"Choose a mode" was verified on 2026-05-02, but its sources changed on 2026-06-02. Owner: octocat. Check the page against the app, fix it, and update verified.',
        "1 docs pages checked, 1 out of date.",
      ],
    });
  });

  it("fails when a sources glob matches no file", () => {
    repo = mkdtempSync(path.join(tmpdir(), "docs-freshness-"));
    git(["init", "-q"]);
    write(
      "apps/web/content/docs/modes.mdx",
      page(["apps/app/src/removed/**"], "2026-05-02"),
    );
    commit("2026-05-01");

    const result = run();
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(
      /^::error file=apps\/web\/content\/docs\/modes\.mdx,title=Docs source matches no file::.*apps\/app\/src\/removed\/\*\*.*Owner: octocat\.$/u,
    );
  });
});
