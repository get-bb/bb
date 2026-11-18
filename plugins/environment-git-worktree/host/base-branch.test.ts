import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRANCH_REF_CASES,
  DEFAULT_BRANCH_REF_CASES,
  createBranchRefFixture,
} from "bb-environment-provider-host/testing/branch-ref-cases";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorktreeBaseBranch } from "./base-branch.js";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bb-worktree-base-ref-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("worktree base branch resolution", () => {
  it.each(BRANCH_REF_CASES)("named base: $name", async (testCase) => {
    const fixture = await createBranchRefFixture(await fixtureRoot(), testCase);
    const resolved = await resolveWorktreeBaseBranch(fixture.path, {
      kind: "named",
      name: testCase.requested,
    });
    expect(resolved?.ref).toBe(testCase.expected.ref);
  });

  it.each(DEFAULT_BRANCH_REF_CASES)("default base: $name", async (testCase) => {
    const fixture = await createBranchRefFixture(
      await fixtureRoot(),
      testCase,
      { originHead: true },
    );
    const resolved = await resolveWorktreeBaseBranch(fixture.path, {
      kind: "default",
    });
    expect(resolved?.ref).toBe(testCase.expected.ref);
  });
});
