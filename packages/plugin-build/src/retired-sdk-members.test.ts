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
    [
      "optional chaining",
      "sdk.environments?.diff({ environmentId })",
      ["diff"],
    ],
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

  it.each([
    [
      "ctx.openPanel",
      'context.openPanel({ actionId: "chat" })',
      "ctx.openPanel",
    ],
    [
      "a destructured openPanel",
      "run: ({ threadId, openPanel }) => openPanel({ params: threadId })",
      "ctx.openPanel",
    ],
    [
      "useBbNavigate().openThreadPanel",
      'navigate.openThreadPanel({ actionId: "task" })',
      "useBbNavigate().openThreadPanel",
    ],
    [
      "a destructured openThreadPanel",
      "const { openThreadPanel } = useBbNavigate();",
      "useBbNavigate().openThreadPanel",
    ],
    [
      "experimental_openTab",
      'panel.experimental_openTab({ surface: { kind: "current" }, tab })',
      "experimental_useAppPanel().experimental_openTab",
    ],
    [
      "openFixedTab",
      "panel.openFixedTab({ surface, tab: { panelId, id } })",
      "experimental_useAppPanel().openFixedTab",
    ],
  ])(
    "flags %s with its panel controller replacement",
    (_label, source, name) => {
      const warnings = retiredSdkMemberWarnings(source);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        new RegExp(
          `^${name.replace(/[.()]/gu, "\\$&")} is retired\\. Use .*openTab\\(`,
          "u",
        ),
      );
    },
  );

  it("leaves the panel controller and unrelated openPanel keys alone", () => {
    expect(
      retiredSdkMemberWarnings(
        "panel.openTab({ tab }); ctx.experimental_panel.toggleTab({ tab }); const deps = { openPanel: () => true };",
      ),
    ).toEqual([]);
  });
});
