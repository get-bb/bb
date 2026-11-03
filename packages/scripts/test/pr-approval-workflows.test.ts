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
  return `gh() { if [ "$1 $2" = "api graphql" ]; then printf '%s\\n' "\${LINKED_ISSUES:-0}"; else printf '%s\\n' "$*"; fi; }\nsleep() { :; }\n${stepScript("pr-gate.yml", "Check approval, maintainer edits, and linked issue, and close failing PRs")}`;
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
      PR_AUTHOR_TYPE: "Bot",
      PR_ASSOCIATION: "NONE",
      EVENT_ACTION: "opened",
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
      PR_AUTHOR_TYPE: "User",
      PR_ASSOCIATION: association,
      EVENT_ACTION: "opened",
      LINKED_ISSUES: "1",
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
  expect(blocked.stdout).toContain(
    '"Allow edits by maintainers" is turned off',
  );
  expect(blocked.stdout).toContain("pr close");
  expect(blocked.stdout).not.toContain("--add-label needs-approval");
  const unapproved = gate("NONE", "fork-author/bb", "User", "true");
  expect(unapproved.stdout).toContain("Contributor approval");
  expect(unapproved.stdout).not.toContain("Maintainer edits");
  expect(unapproved.stdout).toContain("pr close");
  const unapprovedBlocked = gate("NONE", "fork-author/bb", "User", "false");
  expect(unapprovedBlocked.stdout).toContain(
    '"Allow edits by maintainers" is turned off',
  );
  expect(unapprovedBlocked.stdout).toContain("Contributor approval");
});

it("requires pull requests from outside the team to close an open issue", ({
  skip,
}) => {
  skip(
    process.platform === "win32",
    "this workflow step runs in bash on Linux runners",
  );
  const script = gateScript();
  const gate = (env: Record<string, string>) =>
    run(script, {
      PR_AUTHOR: "fork-author",
      PR_AUTHOR_TYPE: "User",
      PR_ASSOCIATION: "COLLABORATOR",
      PR_NUMBER: "123",
      PR_STATE: "open",
      PR_NEEDS_ISSUE: "false",
      EVENT_ACTION: "opened",
      GITHUB_REPOSITORY: "get-bb/bb",
      HEAD_REPO: "fork-author/bb",
      HEAD_OWNER_TYPE: "User",
      MAINTAINER_CAN_MODIFY: "true",
      LINKED_ISSUES: "0",
      ...env,
    });
  const unlinked = gate({});
  expect(unlinked.stdout).toContain("Linked issue");
  expect(unlinked.stdout).toContain("reopens on its own");
  expect(unlinked.stdout).toContain("--add-label needs-issue");
  expect(unlinked.stdout).toContain("pr close");
  const linked = gate({ LINKED_ISSUES: "1" });
  expect(linked.stdout).toContain("--remove-label needs-issue");
  expect(linked.stdout).not.toContain("pr close");
  const keptOpen: Record<string, string>[] = [
    { PR_ASSOCIATION: "MEMBER" },
    { PR_ASSOCIATION: "OWNER" },
    { EVENT_ACTION: "synchronize" },
  ];
  for (const env of keptOpen) {
    expect(gate(env).stdout).not.toContain("pr close");
  }
  const closedForIssue = {
    EVENT_ACTION: "edited",
    PR_STATE: "closed",
    PR_NEEDS_ISSUE: "true",
  };
  expect(gate({ ...closedForIssue, LINKED_ISSUES: "1" }).stdout).toContain(
    "pr reopen",
  );
  const leftAlone: Record<string, string>[] = [
    closedForIssue,
    { ...closedForIssue, LINKED_ISSUES: "1", PR_ASSOCIATION: "NONE" },
    { ...closedForIssue, LINKED_ISSUES: "1", PR_NEEDS_ISSUE: "false" },
    { EVENT_ACTION: "edited", LINKED_ISSUES: "0" },
  ];
  for (const env of leftAlone) {
    const result = gate(env);
    expect(result.stdout).not.toContain("pr reopen");
    expect(result.stdout).not.toContain("pr close");
  }
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
