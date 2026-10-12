import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map(({ harness }) => harness.lifecycle.dispose()),
  );
});

function createHost() {
  const host = createFakePluginHost({
    pluginId: "project-handoff",
    sdk: {
      projects: {
        get: async () => ({
          id: "proj_handoff",
          name: "Handoff [demo]\nproject",
          kind: "standard",
          gitRemoteUrl: null,
          sources: [],
          createdAt: 0,
          updatedAt: 0,
        }),
      },
      threads: {
        list: async () => [
          makeThreadResponse({
            id: "thr_handoff",
            projectId: "proj_handoff",
            title: "Review *decisions*",
            status: "idle",
          }),
        ],
      },
    },
  });
  hosts.push(host);
  plugin(host.bb);
  return host.harness;
}

describe("project handoff CLI", () => {
  it("exports only the selected project's active visible threads with bounded queries", async () => {
    const harness = createHost();
    const result = await harness.behavior.runCli(["export", "proj_handoff"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "# Handoff \\[demo\\] project — project handoff",
    );
    expect(result.stdout).toContain(
      "Review \\*decisions\\* — idle — @thread:thr_handoff",
    );
    expect(result.stdout).toContain("No sources configured.");
    expect(harness.inspection.sdk.callsTo("projects.get")).toEqual([
      [{ projectId: "proj_handoff" }],
    ]);
    expect(harness.inspection.sdk.callsTo("threads.list")).toEqual([
      [
        {
          projectId: "proj_handoff",
          archived: false,
          includeHidden: false,
          limit: 100,
        },
      ],
    ]);
  });

  it("rejects missing IDs and extra arguments without fetching data", async () => {
    const harness = createHost();
    for (const args of [["export"], ["export", "proj_handoff", "unexpected"]]) {
      expect((await harness.behavior.runCli(args)).exitCode).toBe(1);
    }
    expect(harness.inspection.sdk.calls).toHaveLength(0);
  });

  it("reports project lookup errors as CLI failures", async () => {
    const harness = createHost();
    harness.sdk.stub("projects.get", async () => {
      throw new Error("Project not found");
    });
    expect(await harness.behavior.runCli(["export", "missing"])).toEqual(
      expect.objectContaining({ exitCode: 1, stderr: "Project not found" }),
    );
  });
});
