import { describe, expect, it, vi } from "vitest";
import type { ThreadMetadataResponse } from "@bb/server-contract";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

function makeThreadMetadataResponse(): ThreadMetadataResponse {
  const thread = fixtures.makeThread({
    id: "thread-meta",
    projectId: "proj-1",
    providerId: "codex",
    environmentId: "env-meta",
    status: "idle",
    title: "Metadata thread",
    parentThreadId: "thread-parent",
    sourceThreadId: "thread-source",
    originKind: "fork",
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_010_000,
  });
  const environment = fixtures.makeEnvironment({
    id: "env-meta",
    projectId: "proj-1",
    hostId: "host-1",
    branchName: "bb/metadata",
    path: "/tmp/thread-metadata",
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_010_000,
  });

  return {
    thread: {
      ...thread,
      canSpawnChild: true,
      runtime: {
        displayStatus: "idle",
        hostReconnectGraceExpiresAt: null,
      },
    },
    environment,
    spawn: {
      eventSeq: 1,
      requestedAt: 1_800_000_001_000,
      source: "spawn",
      initiator: "user",
      senderThreadId: null,
      target: { kind: "thread-start" },
      requestMethod: "thread/start",
      execution: {
        model: "gpt-5.5",
        serviceTier: "fast",
        reasoningLevel: "xhigh",
        permissionMode: "workspace-write",
        source: "client/turn/requested",
      },
    },
    timestamps: {
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_010_000,
      archivedAt: null,
      pinnedAt: null,
      firstEventAt: 1_800_000_001_000,
      lastEventAt: 1_800_000_003_000,
    },
    eventMetadata: {
      totalEventCount: 3,
      eventsWithMetadataCount: 2,
      metadataObjectCount: 2,
      categories: [
        {
          source: "system/operation.data.metadata",
          eventType: "system/operation",
          eventCount: 1,
          metadataObjectCount: 1,
          keys: ["action", "nextParentThreadId"],
        },
        {
          source: "system/thread-provisioning.data.entries[].metadata",
          eventType: "system/thread-provisioning",
          eventCount: 1,
          metadataObjectCount: 1,
          keys: ["branchName"],
        },
      ],
    },
    pullRequest: {
      status: "not_found",
      source: "environment-branch",
      pullRequest: null,
      message: null,
    },
  };
}

describe("bb thread metadata command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread metadata renders a compact human-readable summary", async () => {
    const metadata = makeThreadMetadataResponse();
    const metadataGet = vi.fn(async () => metadata);
    stubServerApi({
      "v1.threads.:id.metadata.$get": metadataGet,
    });

    await runCommand(["thread", "metadata", "thread-meta"], register);

    expect(metadataGet).toHaveBeenCalledWith({
      param: { id: "thread-meta" },
    });
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Thread metadata: thread-meta");
    expect(output).toContain("Title:     Metadata thread");
    expect(output).toContain("Provider:  codex");
    expect(output).toContain("Branch:    bb/metadata");
    expect(output).toContain("Model:      gpt-5.5");
    expect(output).toContain("Permission: workspace-write");
    expect(output).toContain("Events:    3 total, 2 with metadata");
    expect(output).toContain("system/operation.data.metadata");
    expect(output).toContain("Pull request: none found");
  });

  it("bb thread metadata --json prints the structured metadata response", async () => {
    const metadata = makeThreadMetadataResponse();
    const metadataGet = vi.fn(async () => metadata);
    stubServerApi({
      "v1.threads.:id.metadata.$get": metadataGet,
    });

    await runCommand(["thread", "metadata", "thread-meta", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(metadata, null, 2),
    ]);
  });
});
