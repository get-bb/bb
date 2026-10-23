// @vitest-environment jsdom

import { expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

it("registers the Diff tab, Info rows and sections, and the composer segment", () => {
  expect(app.tabs).toMatchObject([
    {
      id: "diff",
      context: { kind: "thread" },
      availability: "fixed",
      experimental_shortcutCommandId: "toggle-diff",
    },
  ]);
  expect(app.tabs[0]?.experimental_target?.validate({ kind: "file", path: "a.ts" })).toBe(true);
  expect(app.tabs[0]?.experimental_target?.validate({ kind: "nope" })).toBe(false);
  expect(app.threadInfoRows.map((row) => row.id)).toEqual([
    "branch",
    "merge-base",
    "git-status",
  ]);
  expect(app.threadInfoSections.map((section) => section.id)).toEqual([
    "commits",
    "uncommitted-changes",
  ]);
  expect(app.threadContextSegments).toMatchObject([
    { id: "changed-files", group: "3_git", order: 10 },
  ]);
});
