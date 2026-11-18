import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BRANCH_REF_CASES,
  DEFAULT_BRANCH_REF_CASES,
  createBranchRefFixture,
} from "../src/testing/branch-ref-cases.js";
import {
  ensureGitRepo,
  readDefaultBranchRefs,
  resolveBranchRef,
} from "../src/workspace-git.js";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-branch-ref-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("resolveBranchRef", () => {
  it.each(BRANCH_REF_CASES)("$name", async (testCase) => {
    const fixture = await createBranchRefFixture(await fixtureRoot(), testCase);
    await expect(
      resolveBranchRef(fixture.path, testCase.requested),
    ).resolves.toMatchObject({ ref: testCase.expected.ref });
  });
});

describe("readDefaultBranchRefs base branch", () => {
  it.each(DEFAULT_BRANCH_REF_CASES)("$name", async (testCase) => {
    const fixture = await createBranchRefFixture(
      await fixtureRoot(),
      testCase,
      { originHead: true },
    );
    const refs = await readDefaultBranchRefs(await ensureGitRepo(fixture.path));
    expect(refs.baseBranch?.ref).toBe(testCase.expected.ref);
  });
});
