import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createScriptRunScope } from "./script-runner.js";
import plugin from "./server.js";
import { createAutomationService } from "./service.js";

const PROJECT_ID = "proj_test";
const THREAD_ID = "thr_target";

async function createHost(
  readThread: () => Promise<unknown> = async () => {
    throw new Error("temporary thread read failure");
  },
) {
  const host = createFakePluginHost({
    pluginId: "automations",
    sdk: {
      system: { config: async () => ({ primaryHostId: "host_fake" }) },
      projects: {
        async get({ projectId }) {
          return {
            id: projectId,
            kind: "standard" as const,
            name: "Test Project",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
            sources: [
              {
                id: `psrc_${projectId}`,
                projectId,
                type: "local_path" as const,
                hostId: "host_fake",
                path: "/test/project",
                isDefault: true,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          };
        },
        async list() {
          return [{ id: PROJECT_ID, name: "Test Project", deletedAt: null }];
        },
      },
      providers: {
        async list() {
          return [
            {
              id: "codex",
              capabilities: {
                permissionModes: ["accept-edits", "auto", "full"],
              },
            },
          ] as never;
        },
      },
      threads: {
        async get() {
          return readThread();
        },
        async send() {
          return { ok: true };
        },
        async spawn() {
          throw new Error("unexpected spawn");
        },
      },
    },
  });
  await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
  return host;
}

function createService(host: Awaited<ReturnType<typeof createHost>>) {
  return createAutomationService({
    bb: host.bb as never,
    db: host.bb.storage.database(),
    pluginDataDir: "/tmp/bb-automations-read-failure-test",
    serverUrl: "http://127.0.0.1:38886",
    scriptRuns: createScriptRunScope(),
  });
}

async function createTargetAutomation(
  service: ReturnType<typeof createService>,
  name: string,
) {
  return service.create({
    projectId: PROJECT_ID,
    name,
    enabled: true,
    trigger: {
      triggerType: "once",
      runAt: Date.now() + 60_000,
    },
    execution: {
      mode: "agent",
      prompt: "run the check",
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
      environment: { type: "project-default" },
      targetThreadId: THREAD_ID,
    },
    origin: "human",
  });
}

async function waitForFailedRun(
  service: ReturnType<typeof createService>,
  automationId: string,
) {
  await vi.waitFor(() =>
    expect(
      service.runs({
        projectId: PROJECT_ID,
        automationId,
        limit: 50,
      }).runs[0]?.status,
    ).toBe("failed"),
  );
}

describe("target thread read failures", () => {
  it("keeps all target automations enabled after a temporary read failure", async () => {
    const host = await createHost();
    const service = createService(host);
    const first = await createTargetAutomation(service, "First target");
    const second = await createTargetAutomation(service, "Second target");

    await service.run({
      projectId: PROJECT_ID,
      automationId: first.id,
    });

    await waitForFailedRun(service, first.id);
    const states = await Promise.all([
      service.get({ projectId: PROJECT_ID, automationId: first.id }),
      service.get({ projectId: PROJECT_ID, automationId: second.id }),
    ]);
    expect(states).toMatchObject([
      {
        enabled: true,
        lastError: "temporary thread read failure",
      },
      {
        enabled: true,
        lastError: null,
      },
    ]);

    await host.harness.dispose();
  });

  it.each([
    {
      cause: "a verified missing thread",
      readThread: async () => {
        throw Object.assign(new Error("thread not found"), { status: 404 });
      },
      error: "Target thread thr_target no longer exists",
    },
    {
      cause: "an archived thread",
      readThread: async () => ({
        id: THREAD_ID,
        status: "idle",
        archivedAt: 1,
        deletedAt: null,
      }),
      error: "Target thread thr_target was archived",
    },
  ])(
    "disables target automations with the reason for $cause",
    async ({ readThread, error }) => {
      const host = await createHost(readThread);
      const service = createService(host);
      const first = await createTargetAutomation(service, "First target");
      const second = await createTargetAutomation(service, "Second target");

      await service.run({
        projectId: PROJECT_ID,
        automationId: first.id,
      });

      await waitForFailedRun(service, first.id);
      expect(
        service.runs({
          projectId: PROJECT_ID,
          automationId: first.id,
          limit: 1,
        }).runs[0],
      ).toMatchObject({ status: "failed", threadId: null, error });
      const states = await Promise.all([
        service.get({ projectId: PROJECT_ID, automationId: first.id }),
        service.get({ projectId: PROJECT_ID, automationId: second.id }),
      ]);
      expect(states).toMatchObject([
        { enabled: false, lastError: error },
        { enabled: false, lastError: error },
      ]);

      await host.harness.dispose();
    },
  );
});
