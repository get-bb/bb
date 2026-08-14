// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

beforeAll(() => installTestPluginRuntime());
afterEach(cleanup);

async function chipRegistration() {
  const module = await import("./PendingChangesChip.js");
  return {
    component: () => (
      <module.PendingChangesChip
        scope={{ projectId: "platform-project", pvId: "version-7" }}
        surface="vexDecision"
      />
    ),
  };
}

describe("PendingChangesChip", () => {
  it("leaves safe route segments raw for host navigation encoding", async () => {
    const { syncScopeSubPath } = await import("./PendingChangesChip.js");

    expect(syncScopeSubPath({ projectId: "qa-project", pvId: null })).toBe(
      "scope/qa-project/@project",
    );
    expect(() =>
      syncScopeSubPath({ projectId: "unsafe/project", pvId: null }),
    ).toThrow("Invalid Sync review route scope");
  });

  it("shows local and conflict counts and opens the validated scoped route", async () => {
    const slot = renderSlot(
      await chipRegistration(),
      {},
      {
        context: { projectId: "workspace-project", threadId: null },
        rpc: {
          syncStatus: () => ({
            projectId: "platform-project",
            projectVersionId: "version-7",
            acceptedGenerationIds: {},
            stagingGenerationIds: {},
            baseRevisions: {},
            baseStateSha256: "a".repeat(64),
            local: [
              {
                projectId: "platform-project",
                projectVersionId: "version-7",
                kind: "vexDecision",
                key: "vex-1",
                fields: ["status"],
                artifactId: ".fs/triage/vex-1.yaml",
              },
              {
                projectId: "platform-project",
                projectVersionId: "version-7",
                kind: "vexDecision",
                key: "vex-2",
                fields: ["status"],
                artifactId: ".fs/triage/vex-2.yaml",
              },
            ],
            upstream: [],
            conflicts: [
              {
                projectId: "platform-project",
                projectVersionId: "version-7",
                kind: "vexDecision",
                key: "vex-2",
                fields: ["status"],
                artifactId: null,
              },
            ],
            orphans: [],
            cache: {
              state: "fresh",
              asOf: "2026-08-13T00:00:00.000Z",
              message: null,
              acceptedGenerationId: "generation-1",
              baseRevision: 1,
            },
          }),
        },
      },
    );

    const button = await slot.findByRole("button", {
      name: "Open Sync review: 2 local changes and 1 conflict",
    });
    expect(slot.getByText("2 local · 1 conflict")).toBeTruthy();
    fireEvent.click(button);

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "sync",
        options: {
          subPath: "scope/platform-project/version-7/surface/vexDecision",
        },
      },
    ]);
    expect(slot.inspection.rpcCalls[0]).toEqual({
      method: "syncStatus",
      input: {
        projectId: "platform-project",
        projectVersionId: "version-7",
        workspaceProjectId: "workspace-project",
        kinds: ["vexDecision"],
      },
    });
  });
});
