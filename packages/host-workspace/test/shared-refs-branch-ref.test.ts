import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRANCH_REF_CASES,
  createBranchRefFixture,
} from "bb-environment-provider-host/testing/branch-ref-cases";
import { runGit } from "bb-environment-provider-host/workspace-git";
import { afterEach, describe, expect, it } from "vitest";
import { readSharedGitRefsSnapshot } from "../src/git.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function fullRefName(ref: string): string {
  if (ref.startsWith("refs/")) return ref;
  if (ref.startsWith("origin/")) return `refs/remotes/${ref}`;
  return `refs/heads/${ref}`;
}

describe("shared refs fingerprint for a merge-base branch", () => {
  it.each(
    BRANCH_REF_CASES.filter((testCase) => testCase.expected.commit !== null),
  )("changes when the resolved ref moves: $name", async (testCase) => {
    const root = await mkdtemp(join(tmpdir(), "bb-shared-refs-base-ref-"));
    roots.push(root);
    const fixture = await createBranchRefFixture(root, testCase);
    const refs = { branchName: null, mergeBaseBranch: testCase.requested };
    const before = (await readSharedGitRefsSnapshot(root)).fingerprintFor(refs);
    const resolvedCommit = fixture.expectedCommit;
    if (resolvedCommit === null) throw new Error("case has no commit");
    const moved = await runGit(
      [
        "-c",
        "user.name=bb",
        "-c",
        "user.email=bb@example.com",
        "commit-tree",
        `${resolvedCommit}^{tree}`,
        "-p",
        resolvedCommit,
        "-m",
        "fetched",
      ],
      { cwd: root },
    );
    await runGit(
      ["update-ref", fullRefName(testCase.expected.ref), moved.stdout.trim()],
      { cwd: root },
    );
    const after = (await readSharedGitRefsSnapshot(root)).fingerprintFor(refs);
    expect(after).not.toBe(before);
  });
});
