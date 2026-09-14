import { describe, expect, it } from "vitest";
import type { GitRef } from "../contract.js";
import { buildRefChips } from "./ref-pills.js";

function ref(name: string, kind: GitRef["kind"], isHead = false): GitRef {
  return { name, kind, isHead };
}

describe("buildRefChips", () => {
  it("folds remote-tracking refs into the local branch chip of the same name", () => {
    const chips = buildRefChips([
      ref("main", "branch", true),
      ref("feature", "branch"),
      ref("origin/main", "remote"),
      ref("upstream/main", "remote"),
      ref("origin/topic", "remote"),
      ref("v1.0", "tag"),
    ]);
    expect(chips.map((chip) => [chip.kind, chip.label, chip.remotes])).toEqual([
      ["head", "main", ["origin", "upstream"]],
      ["branch", "feature", []],
      ["remote", "origin/topic", []],
      ["tag", "v1.0", []],
    ]);
    expect(chips[0]?.title).toBe(
      "HEAD → main (checked out)\nAlso on origin/main, upstream/main",
    );
  });

  it("keeps a detached HEAD and remote-only refs as their own chips", () => {
    const chips = buildRefChips([
      ref("HEAD", "other", true),
      ref("origin/release/2026.09", "remote"),
      ref("stash", "stash"),
    ]);
    expect(chips.map((chip) => chip.kind)).toEqual([
      "detached",
      "remote",
      "stash",
    ]);
    expect(chips.map((chip) => chip.title)).toEqual([
      "HEAD (detached)",
      "Remote branch origin/release/2026.09",
      "Stash stash",
    ]);
  });

  it("does not fold a remote ref whose branch only ends with the local name", () => {
    const chips = buildRefChips([
      ref("main", "branch"),
      ref("origin/feature/main", "remote"),
    ]);
    expect(chips.map((chip) => [chip.kind, chip.remotes])).toEqual([
      ["branch", []],
      ["remote", []],
    ]);
  });
});
