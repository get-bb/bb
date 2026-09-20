import { describe, expect, it } from "vitest";
import { isBbManagedWorkspacePath } from "./workspace-paths.js";

const dataDir = "/home/user/.bb";

describe("isBbManagedWorkspacePath", () => {
  it("recognises a worktree under a plugin's host data directory", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/plugins/environment-git-worktree/host-data/worktrees/thr_abc-1/repo`,
      }),
    ).toBe(true);
  });

  it("recognises a personal workspace under a plugin's host data directory", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/plugins/environment-personal-workspace/host-data/personal-workspaces/thr_abc`,
      }),
    ).toBe(true);
  });

  it("recognises the pre-plugin workspace roots", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/worktrees/env_abc/repo`,
      }),
    ).toBe(true);
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/personal-workspaces/env_abc`,
      }),
    ).toBe(true);
  });

  it("leaves plugin storage that is not process data alone", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/plugins/some-plugin/source/index.ts`,
      }),
    ).toBe(false);
    expect(
      isBbManagedWorkspacePath({ dataDir, path: `${dataDir}/plugins` }),
    ).toBe(false);
  });

  it("leaves paths outside the data directory alone", () => {
    expect(
      isBbManagedWorkspacePath({ dataDir, path: "/home/user/code/repo" }),
    ).toBe(false);
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: "/home/user/.bb-other/worktrees/env_abc",
      }),
    ).toBe(false);
  });

  it("does not treat a sibling prefix as a managed root", () => {
    expect(
      isBbManagedWorkspacePath({
        dataDir,
        path: `${dataDir}/worktrees-backup/env_abc`,
      }),
    ).toBe(false);
  });
});
