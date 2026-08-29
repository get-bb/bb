import { describe, expect, it } from "vitest";
import type { PluginComposerMention } from "../app-contract.js";

function acceptMention(mention: PluginComposerMention): PluginComposerMention {
  return mention;
}

describe("PluginComposerMention", () => {
  it("accepts provider and BB-owned forms", () => {
    expect(
      acceptMention({ provider: "issues", id: "ENG-42", label: "ENG-42" }),
    ).toMatchObject({ provider: "issues" });
    expect(acceptMention({ kind: "thread", threadId: "thr_42" })).toMatchObject(
      { kind: "thread" },
    );
    expect(
      acceptMention({
        kind: "path",
        source: "thread-storage",
        path: "reports/result.md",
      }),
    ).toMatchObject({ kind: "path" });
  });

  it("does not accept caller-owned labels for BB-owned forms", () => {
    // @ts-expect-error BB resolves the label for a built-in mention.
    acceptMention({ kind: "project", projectId: "proj_42", label: "Alias" });
  });
});
