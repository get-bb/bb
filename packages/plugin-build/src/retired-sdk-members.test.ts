import { describe, expect, it } from "vitest";
import { retiredSdkMemberWarnings } from "./retired-sdk-members.js";

function retiredNames(source: string): string[] {
  return retiredSdkMemberWarnings(source)
    .map((warning) => /^environments\.(\w+) /u.exec(warning)?.[1] ?? "")
    .sort();
}

describe("retiredSdkMemberWarnings", () => {
  it.each([
    ["a call", "sdk.environments.status({ environmentId })", ["status"]],
    ["optional chaining", "sdk.environments?.diff({ environmentId })", ["diff"]],
    ["an alias", "const read = bb.sdk.environments.diffPatch;", ["diffPatch"]],
    ["bracket access", 'sdk.environments["diffFile"](args)', ["diffFile"]],
    [
      "destructuring",
      "const { diffFiles, diffBranches: branches, list } = bb.sdk.environments;",
      ["diffBranches", "diffFiles"],
    ],
  ])("flags %s", (_label, source, names) => {
    expect(retiredNames(source)).toEqual(names);
  });

  it("leaves the environment record's status and the remaining methods alone", () => {
    expect(
      retiredNames(
        "environment.status === 'ready'; sdk.environments.get({ id }); sdk.environments.list();",
      ),
    ).toEqual([]);
  });
});
