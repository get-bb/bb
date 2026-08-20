import { describe, expect, it } from "vitest";
import type { PanelScope } from "../panel/panel-model";
import {
  terminalCreateScopeForPanelScope,
  terminalListScopeForPanelScope,
} from "./terminal-scope";

const thread: PanelScope = {
  kind: "thread",
  threadId: "thr_1",
  projectId: "prj_1",
  environmentId: "env_1",
  hostId: "host_1",
};

describe("terminal panel scopes", () => {
  it("uses the thread itself in thread scope, even with an environment", () => {
    expect(terminalListScopeForPanelScope(thread)).toEqual({
      kind: "thread",
      threadId: "thr_1",
    });
    expect(terminalCreateScopeForPanelScope(thread)).toEqual({
      kind: "thread",
      threadId: "thr_1",
    });
  });

  it("prefers a reused worktree over the machine in project scope", () => {
    const scope: PanelScope = {
      kind: "project",
      projectId: "prj_1",
      environmentId: "env_9",
      hostId: "host_1",
    };
    expect(terminalListScopeForPanelScope(scope)).toEqual({
      kind: "environment",
      environmentId: "env_9",
    });
    expect(terminalCreateScopeForPanelScope(scope)).toEqual({
      kind: "environment",
      environmentId: "env_9",
    });
  });

  it("falls back to the machine's home directory, then to nothing", () => {
    const hostOnly: PanelScope = {
      kind: "project",
      projectId: null,
      environmentId: null,
      hostId: "host_1",
    };
    expect(terminalListScopeForPanelScope(hostOnly)).toEqual({
      kind: "host_path",
      hostId: "host_1",
    });
    // The create target must name the directory explicitly (null = home).
    expect(terminalCreateScopeForPanelScope(hostOnly)).toEqual({
      kind: "host_path",
      hostId: "host_1",
      cwd: null,
    });
    const empty: PanelScope = {
      kind: "project",
      projectId: "prj_1",
      environmentId: null,
      hostId: null,
    };
    expect(terminalListScopeForPanelScope(empty)).toBeNull();
    expect(terminalCreateScopeForPanelScope(empty)).toBeNull();
  });
});
