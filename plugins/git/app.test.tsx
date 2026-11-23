// @vitest-environment jsdom
import {
  experimental_makeActionContext,
  experimental_makePanelController,
} from "@get-bb/plugin-sdk/testing";

import { expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app.js"));

it("registers the Diff tab, Info rows and sections, the composer segment, and the Commit header action", () => {
  expect(app.tabs).toMatchObject([
    {
      id: "diff",
      context: { kind: "thread" },
      availability: "fixed",
    },
  ]);
  expect(
    app.tabs[0]?.experimental_target?.validate({ kind: "file", path: "a.ts" }),
  ).toBe(true);
  expect(app.tabs[0]?.experimental_target?.validate({ kind: "nope" })).toBe(
    false,
  );
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
  expect(app.threadActions).toMatchObject([
    { id: "commit", placement: "header", title: "Commit" },
  ]);
  expect(app.appOverlays.map((overlay) => overlay.id)).toEqual([
    "commit-dialog",
  ]);
});

it("toggles the Diff tab through the thread's panel with Mod+D", async () => {
  const [command] = app.commands;
  if (command === undefined) throw new Error("expected a command");
  expect(command).toMatchObject({
    id: "toggle-diff",
    defaultShortcut: { key: "d", mod: true },
  });
  const panel = experimental_makePanelController({
    toggleTab: vi.fn(() => true),
  });
  expect(
    command.isAvailable?.({
      ...experimental_makeActionContext({ panel }),
      threadId: null,
      projectId: null,
    }),
  ).toBe(false);
  await command.run({
    ...experimental_makeActionContext({ panel }),
    threadId: "thr-1",
    projectId: null,
  });
  expect(panel.toggleTab).toHaveBeenCalledWith({
    tab: { id: "diff", context: { kind: "thread" }, availability: "fixed" },
  });
});
