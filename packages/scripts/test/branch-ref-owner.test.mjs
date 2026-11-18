import { describe, expect, it } from "vitest";
import {
  BRANCH_REF_OWNER,
  findBranchRefProblems,
} from "../../../scripts/check-branch-ref-owner.mjs";

const allowlist = {
  "apps/server/src/clone.ts": "fresh clone",
};

function file(path, text) {
  return { path, text };
}

describe("findBranchRefProblems", () => {
  it.each([
    ["an origin ref template", "const ref = `refs/remotes/origin/${name}`;"],
    ["a short origin template", "const ref = `origin/${name}`;"],
    ["an origin prefix concatenation", 'const ref = "origin/" + name;'],
    [
      "an ancestry check",
      'await runGit(["merge-base", "--is-ancestor", a, b]);',
    ],
  ])("rejects %s outside the owner", (_label, text) => {
    expect(
      findBranchRefProblems(
        [
          file("plugins/git/host/git.ts", text),
          file("apps/server/src/clone.ts", "`refs/remotes/origin/${ref}`"),
        ],
        allowlist,
      ),
    ).toEqual([expect.stringContaining("plugins/git/host/git.ts")]);
  });

  it("allows the owner, tests and parsing of origin-prefixed names", () => {
    expect(
      findBranchRefProblems(
        [
          file(BRANCH_REF_OWNER, "`refs/remotes/origin/${name}` --is-ancestor"),
          file("plugins/git/host/git.test.ts", "`origin/${name}`"),
          file("packages/x/test/helper.ts", "`origin/${name}`"),
          file(
            "plugins/git/app.tsx",
            'name.startsWith("origin/") ? name.slice("origin/".length) : name',
          ),
          file("apps/server/src/clone.ts", "`refs/remotes/origin/${ref}`"),
        ],
        allowlist,
      ),
    ).toEqual([]);
  });
});
