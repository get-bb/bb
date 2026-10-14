import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function stepScript(workflow: string, step: string): string {
  const lines = readFileSync(
    resolve(repoRoot, ".github/workflows", workflow),
    "utf8",
  ).split("\n");
  const stepIndex = lines.indexOf(`      - name: ${step}`);
  const runIndex = lines.indexOf("        run: |", stepIndex);
  let end = runIndex + 1;
  while (
    end < lines.length &&
    (lines[end] === "" || lines[end]?.startsWith("          "))
  )
    end += 1;
  return lines
    .slice(runIndex + 1, end)
    .map((line) => line.slice(10))
    .join("\n");
}

function run(script: string, env: Record<string, string>) {
  return spawnSync("bash", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function gateScript(): string {
  return `gh() { printf '%s\\n' "$*"; }\n${stepScript("pr-gate.yml", "Check approval and maintainer edits, and close failing PRs")}`;
}

it("keeps trusted automation pull requests open", ({ skip }) => {
  skip(
    process.platform === "win32",
    "this workflow step runs in bash on Linux runners",
  );
  const script = gateScript();
  const gate = (author: string) =>
    run(script, {
      PR_AUTHOR: author,
      PR_ASSOCIATION: "NONE",
      PR_NUMBER: "123",
      GITHUB_REPOSITORY: "get-bb/bb",
    });
  for (const author of ["bb-slop-cop[bot]", "dependabot[bot]"]) {
    const result = gate(author);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--remove-label needs-approval");
    expect(result.stdout).not.toContain("pr close");
  }
  expect(gate("untrusted-automation[bot]").stdout).toContain("pr close");
});

it("closes personal fork pull requests that block maintainer edits", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "this workflow step runs in bash on Linux runners",
  );
  const script = gateScript();
  const gate = (
    association: string,
    headRepo: string,
    ownerType: string,
    canModify: string,
  ) =>
    run(script, {
      PR_AUTHOR: "fork-author",
      PR_ASSOCIATION: association,
      PR_NUMBER: "123",
      GITHUB_REPOSITORY: "get-bb/bb",
      HEAD_REPO: headRepo,
      HEAD_OWNER_TYPE: ownerType,
      MAINTAINER_CAN_MODIFY: canModify,
    });
  for (const [headRepo, ownerType, canModify] of [
    ["fork-author/bb", "User", "true"],
    ["acme/bb", "Organization", "false"],
    ["get-bb/bb", "Organization", "false"],
    ["", "", "false"],
  ]) {
    const result = gate("MEMBER", headRepo, ownerType, canModify);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("pr close");
  }
  const blocked = gate("MEMBER", "fork-author/bb", "User", "false");
  expect(blocked.stdout).toContain('"Allow edits by maintainers" turned off');
  expect(blocked.stdout).toContain("pr close");
  expect(blocked.stdout).not.toContain("--add-label needs-approval");
  const unapproved = gate("NONE", "fork-author/bb", "User", "true");
  expect(unapproved.stdout).toContain("post a link to this PR");
  expect(unapproved.stdout).toContain("pr close");
  const unapprovedBlocked = gate("NONE", "fork-author/bb", "User", "false");
  expect(unapprovedBlocked.stdout).toContain(
    '"Allow edits by maintainers" turned off',
  );
  expect(unapprovedBlocked.stdout).toContain("post a link to the new PR");
});

it("parses only complete GitHub user and bot approval commands", ({ skip }) => {
  skip(
    process.platform === "win32",
    "this workflow step runs in bash on Linux runners",
  );
  const workflow = stepScript("approve-contributor.yml", "Add name and push");
  const parser = `${workflow.slice(0, workflow.indexOf("list_path="))}printf '%s' "$target"`;
  for (const [comment, target] of [
    ["/approve @trusted-user", "trusted-user"],
    ["/approve @dependabot[bot]", "dependabot[bot]"],
  ]) {
    const result = run(parser, { COMMENT_BODY: comment });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(target);
  }
  for (const comment of [
    "/approve @bad-",
    "/approve @bad--name",
    "/approve @dependabot[bot] trailing",
    "/approve @user; echo unsafe",
  ]) {
    expect(run(parser, { COMMENT_BODY: comment }).status).not.toBe(0);
  }
});
