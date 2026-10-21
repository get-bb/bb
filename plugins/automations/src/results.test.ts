import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  closeAutomationRun,
  createAutomation,
  createManualRun,
  migrations,
  setAutomationRunThread,
} from "./data.js";
import { createAutomationResults } from "./results.js";

const snapshot = {
  repo: "acme/widgets",
  branch: "automation/fix-tests",
  commit: "a".repeat(40),
  baseBranch: "main",
  baseCommit: "b".repeat(40),
};
const publication = {
  threadId: "thread-result",
  snapshot,
  title: "Fix tests",
  body: "Fix the failing test.",
};
const hosts: FakePluginHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(({ harness }) => harness.dispose()));
});

function fixture(
  options: {
    networkAccess?: boolean;
    runStatus?: "running" | "succeeded" | "failed";
    publish?: () => Promise<{ url: string }>;
  } = {},
) {
  const thread = makeThreadResponse({
    id: publication.threadId,
    projectId: "project-result",
    environmentId: "environment-result",
    originPluginId: "automations",
    providerId: "codex",
  });
  const environment = {
    id: "environment-result",
    projectId: thread.projectId,
    hostId: "host-result",
    status: "ready",
    path: "/workspace/result",
    baseBranch: "main",
    defaultBranch: "main",
  };
  const host = createFakePluginHost({
    pluginId: "automations",
    sdk: {
      threads: { get: async () => thread },
      environments: { get: async () => environment },
    },
    experimental_callHostRpc: async ({ method }) => {
      if (method === "inspectPublication") return { status: "ready", snapshot };
      if (method === "publish")
        return options.publish
          ? await options.publish()
          : { url: "https://github.com/acme/widgets/pull/7" };
      throw new Error(`Unexpected host call: ${method}`);
    },
  });
  hosts.push(host);
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, migrations);
  const automation = createAutomation(db, {
    projectId: thread.projectId,
    name: "Fix failing tests",
    enabled: true,
    trigger: { triggerType: "schedule", cron: "0 22 * * 1-5", timezone: "UTC" },
    runMode: "agent",
    execution: {
      mode: "agent",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      prompt: "Fix failing tests locally.",
      networkAccess: options.networkAccess ?? false,
      environment: { type: "project-default" },
    },
    origin: "app",
    createdByThreadId: null,
    nextRunAt: null,
  });
  const { run } = createManualRun(db, {
    automationId: automation.id,
    runMode: "agent",
    now: 1,
  });
  setAutomationRunThread(db, { runId: run.id, threadId: thread.id });
  if (options.runStatus !== "running") {
    closeAutomationRun(db, {
      runId: run.id,
      status: options.runStatus ?? "succeeded",
      now: 2,
    });
  }
  return {
    ...host,
    thread,
    environment,
    automation,
    results: createAutomationResults(host.bb, db),
  };
}

describe("automation result publication", () => {
  it("reads a completed result using only a local inspection", async () => {
    const { results, harness, automation } = fixture();
    await expect(
      results.read({ threadId: publication.threadId }),
    ).resolves.toEqual({
      result: {
        automationId: automation.id,
        name: automation.name,
        inspection: { status: "ready", snapshot },
      },
    });
    expect(harness.experimental_hostRpcCalls).toEqual([
      {
        method: "inspectPublication",
        input: { path: "/workspace/result", baseBranch: "main" },
        hostId: "host-result",
      },
    ]);
  });

  it.each([
    { runStatus: "running" as const },
    { runStatus: "failed" as const },
    { networkAccess: true },
  ])(
    "rejects publication before reaching a host for $runStatus/$networkAccess",
    async (options) => {
      const { results, harness } = fixture(options);
      await expect(
        results.read({ threadId: publication.threadId }),
      ).resolves.toEqual({ result: null });
      await expect(results.publish(publication)).rejects.toThrow(
        "not ready for publication",
      );
      expect(harness.experimental_hostRpcCalls).toEqual([]);
    },
  );

  it("requires the requested thread to belong to a completed run", async () => {
    const { results, harness } = fixture();
    await expect(
      results.publish({ ...publication, threadId: "thread-other" }),
    ).rejects.toThrow("not ready for publication");
    expect(harness.sdk.calls).toEqual([]);
    expect(harness.experimental_hostRpcCalls).toEqual([]);
  });

  it.each([
    "thread-running",
    "thread-project",
    "environment-project",
    "environment-not-ready",
  ])("revalidates %s before accepting a publication click", async (invalid) => {
    const { results, harness, thread, environment } = fixture();
    await results.read({ threadId: publication.threadId });
    if (invalid === "thread-running") thread.status = "active";
    if (invalid === "thread-project") thread.projectId = "project-other";
    if (invalid === "environment-project")
      environment.projectId = "project-other";
    if (invalid === "environment-not-ready") environment.status = "creating";
    await expect(results.publish(publication)).rejects.toThrow(
      "not ready for publication",
    );
    expect(
      harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["inspectPublication"]);
  });

  it("routes an explicit publication to the completed run's current environment and reviewed snapshot", async () => {
    const { results, harness } = fixture();
    await expect(results.publish(publication)).resolves.toEqual({
      url: "https://github.com/acme/widgets/pull/7",
    });
    expect(harness.experimental_hostRpcCalls).toEqual([
      {
        method: "publish",
        input: {
          path: "/workspace/result",
          snapshot,
          title: publication.title,
          body: publication.body,
        },
        hostId: "host-result",
      },
    ]);
    expect(harness.sdk.callsTo("threads.get")).toEqual([
      [{ threadId: publication.threadId }],
    ]);
    expect(harness.sdk.callsTo("environments.get")).toEqual([
      [{ environmentId: "environment-result" }],
    ]);
  });

  it("blocks overlapping clicks and permits retry after a host rejects a stale snapshot", async () => {
    let rejectPublication: (error: Error) => void = () => {
      throw new Error("Publication did not begin");
    };
    let started: () => void = () => {};
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    let attempts = 0;
    const { results, harness } = fixture({
      publish: async () => {
        attempts += 1;
        if (attempts > 1)
          return { url: "https://github.com/acme/widgets/pull/7" };
        started();
        return await new Promise<{ url: string }>((_resolve, reject) => {
          rejectPublication = reject;
        });
      },
    });
    const first = results.publish(publication);
    await didStart;
    await expect(results.publish(publication)).rejects.toThrow(
      "already being published",
    );
    const failure = expect(first).rejects.toThrow("Review it again");
    rejectPublication(
      new Error("The local result changed. Review it again before publishing."),
    );
    await failure;
    await expect(results.publish(publication)).resolves.toEqual({
      url: "https://github.com/acme/widgets/pull/7",
    });
    expect(harness.experimental_hostRpcCalls).toHaveLength(2);
  });
});
