import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRANCH_REF_CASES,
  createBranchRefFixture,
} from "bb-environment-provider-host/testing/branch-ref-cases";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMergeBaseBranch } from "./git.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("git merge-base branch resolution", () => {
  it.each(BRANCH_REF_CASES)("$name", async (testCase) => {
    const root = await mkdtemp(join(tmpdir(), "bb-git-merge-base-ref-"));
    roots.push(root);
    const fixture = await createBranchRefFixture(root, testCase);
    expect(
      (await resolveMergeBaseBranch(fixture.path, testCase.requested)) ?? null,
    ).toBe(fixture.expectedCommit);
  });
});
