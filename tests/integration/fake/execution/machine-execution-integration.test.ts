import {
  buildThreadHandoffCreateRequest,
  buildThreadHandoffPromptDraft,
} from "../../../../packages/client-core/src/prompt/thread-handoff-request.js";
import { createExecutionIntegrationFixture } from "../../../../apps/server/test/helpers/execution-integration-fixture.js";
import { expect, it } from "vitest";
import {
  threadResponseSchema,
  hostExecutionIntegrationSettingsSchema,
  systemExecutionOptionsResponseSchema,
} from "@bb/server-contract";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyHostThread,
  createReadyReuseThread,
} from "../../helpers/fixtures.js";
import {
  getThreadEvents,
  getThreadOutput,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { recordScriptedEchoRequests } from "../../helpers/scripted-echo.js";

const integrationId = "scripted-execution";
const execution = {
  model: "fake-model",
  reasoningLevel: "medium",
  permissionMode: "full",
  serviceTier: "default",
} as const;

async function bind(
  harness: IntegrationHarness,
  selected: string | null = integrationId,
) {
  const response = await harness.api.hosts[":id"][
    "execution-integration"
  ].$patch({
    param: { id: harness.hostId },
    json: { integrationId: selected },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return hostExecutionIntegrationSettingsSchema.parse(await response.json());
}

it("runs starts, continuations, forks, children and daemon reconnects through the required bridge", async () => {
  const record = await recordScriptedEchoRequests();
  const fixtureFiles = await createExecutionIntegrationFixture();
  try {
    await withHarness(async (harness) => {
      const plugin = await harness.server.pluginService.installPath(
        fixtureFiles.root,
      );
      expect(plugin.status, plugin.statusDetail ?? "").toBe("running");
      const project = await createProjectFixture(harness, {
        name: "Machine execution",
      });
      const native = await createReadyHostThread(harness, {
        projectId: project.id,
        providerId: "fake-alpha",
        execution,
        workspace: { type: "unmanaged", path: harness.repoDir },
      });
      expect(await getThreadOutput(harness.api, native.thread.id)).toContain(
        "READY",
      );
      await bind(harness);
      const catalogResponse = await fetch(
        `${harness.serverUrl}/api/v1/system/execution-options?hostId=${harness.hostId}&providerId=fake-alpha`,
      );
      expect(catalogResponse.status).toBe(200);
      const catalog = systemExecutionOptionsResponseSchema.parse(
        await catalogResponse.json(),
      );
      expect(
        catalog.providers.find((provider) => provider.id === "fake-alpha")
          ?.capabilities,
      ).toMatchObject({
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
      });
      expect(catalog.models.map((model) => model.model)).toEqual([
        "fake-model",
      ]);
      expect(
        (await record.read())
          .filter((request) => request.method === "model/list")
          .at(-1)?.params,
      ).toMatchObject({
        executionIntegration: { id: integrationId, providerId: "fake-alpha" },
      });
      const created = await createReadyReuseThread(harness, {
        environmentId: native.environment.id,
        projectId: project.id,
        providerId: "fake-alpha",
        execution,
      });
      await sendTextMessage(harness.api, created.thread.id, {
        text: "required follow-up",
        execution,
      });
      await waitForThreadOutputContaining(
        harness.api,
        created.thread.id,
        "required follow-up",
        15_000,
      );
      await waitForThreadStatus(harness.api, created.thread.id, "idle", 15_000);
      const forkResponse = await harness.api.threads.fork.$post({
        json: {
          sourceThreadId: created.thread.id,
          input: [{ type: "text", mentions: [], text: "required fork" }],
          origin: "sdk",
          visibility: "visible",
        },
      });
      expect(forkResponse.status, await forkResponse.clone().text()).toBe(201);
      const fork = threadResponseSchema.parse(await forkResponse.json());
      await waitForThreadOutputContaining(
        harness.api,
        fork.id,
        "required fork",
        15_000,
      );
      const child = await createReadyReuseThread(harness, {
        projectId: project.id,
        environmentId: created.environment.id,
        providerId: "fake-beta",
        execution,
        parentThreadId: created.thread.id,
      });
      const runtime = harness.daemonApp.runtimeManager.get(
        created.environment.id,
      )?.runtime;
      expect(runtime).toBeDefined();
      await runtime!.stopThread({ threadId: child.thread.id });
      const seed = {
        environmentId: created.environment.id,
        projectId: project.id,
        sourceThreadId: created.thread.id,
        sourceThreadTitle: "Original",
      };
      const handoffRequest = buildThreadHandoffCreateRequest({
        seed,
        draft: buildThreadHandoffPromptDraft(seed),
        execution: {
          ...execution,
          providerId: "fake-beta",
          supportsServiceTier: false,
          executionInputSources: {},
        },
      });
      if (handoffRequest === null)
        throw new Error("Expected a handoff request");
      const handoffResponse = await harness.api.threads.$post({
        json: {
          ...handoffRequest,
          origin: "app",
          originKind: null,
          startedOnBehalfOf: null,
        },
      });
      expect(handoffResponse.status, await handoffResponse.clone().text()).toBe(
        201,
      );
      const handoff = threadResponseSchema.parse(await handoffResponse.json());
      await waitForThreadStatus(harness.api, handoff.id, "idle", 15_000);
      await harness.restartDaemon("execution-integration-reconnect");
      await sendTextMessage(harness.api, created.thread.id, {
        text: "required reconnect",
        execution,
      });
      await waitForThreadOutputContaining(
        harness.api,
        created.thread.id,
        "required reconnect",
        15_000,
      );
      await waitForThreadStatus(harness.api, created.thread.id, "idle", 15_000);
      const requests = await record.read();
      const executions = requests.filter((request) =>
        ["thread/start", "thread/resume", "thread/fork", "turn/start"].includes(
          request.method,
        ),
      );
      for (const threadId of [
        created.thread.id,
        fork.id,
        child.thread.id,
        handoff.id,
      ]) {
        const owned = executions.filter(
          (request) => request.params?.threadId === threadId,
        );
        expect(owned.length).toBeGreaterThan(0);
        for (const request of owned)
          expect(request.params).toMatchObject({
            options: { providerOptions: { executionOwner: "integration" } },
          });
      }
      expect(
        requests.some(
          (request) =>
            request.method === "thread/resume" &&
            request.params?.threadId === created.thread.id,
        ),
      ).toBe(true);
      expect(
        requests.some(
          (request) =>
            request.method === "thread/stop" &&
            request.params?.intent === "release",
        ),
      ).toBe(true);
      const before = executions.filter(
        (request) => request.params?.threadId === native.thread.id,
      ).length;
      const nativeSend = await harness.api.threads[":id"].send.$post({
        param: { id: native.thread.id },
        json: {
          input: [
            { type: "text", mentions: [], text: "must not resume native" },
          ],
          mode: "start",
        },
      });
      expect(nativeSend.status).toBe(409);
      expect(
        (await record.read()).filter(
          (request) =>
            request.params?.threadId === native.thread.id &&
            ["thread/start", "thread/resume", "turn/start"].includes(
              request.method,
            ),
        ),
      ).toHaveLength(before);
      expect(
        (await getThreadEvents(harness.api, created.thread.id)).filter(
          (event) => event.type === "turn/completed",
        ).length,
      ).toBeGreaterThanOrEqual(3);
    });
  } finally {
    await record.dispose();
    await fixtureFiles.cleanup();
  }
}, 90_000);

it("retains unavailable bindings across disable/reload and never starts a native bridge", async () => {
  const record = await recordScriptedEchoRequests();
  const fixtureFiles = await createExecutionIntegrationFixture();
  try {
    await withHarness(async (harness) => {
      const plugin = await harness.server.pluginService.installPath(
        fixtureFiles.root,
      );
      expect(plugin.status, plugin.statusDetail ?? "").toBe("running");
      const project = await createProjectFixture(harness, {
        name: "Required execution unavailable",
      });
      await bind(harness);
      await harness.server.pluginService.setEnabled(plugin.id, false);
      const setting = await harness.api.hosts[":id"][
        "execution-integration"
      ].$get({ param: { id: harness.hostId } });
      expect(
        hostExecutionIntegrationSettingsSchema.parse(await setting.json())
          .required,
      ).toMatchObject({ id: integrationId, available: false });
      for (const providerId of ["fake-alpha", "fake-beta", "codex"]) {
        const result = await harness.api.threads.$post({
          json: {
            projectId: project.id,
            providerId,
            origin: "cli",
            input: [{ type: "text", mentions: [], text: "must not launch" }],
            ...execution,
            environment: {
              type: "host",
              hostId: harness.hostId,
              workspace: { type: "unmanaged", path: harness.repoDir },
            },
            startedOnBehalfOf: null,
            originKind: null,
          },
        });
        expect(result.status, await result.clone().text()).toBe(409);
      }
      expect(
        (await record.read()).filter(
          (request) =>
            request.method === "thread/start" ||
            request.method === "turn/start",
        ),
      ).toEqual([]);
      await harness.server.pluginService.setEnabled(plugin.id, true);
      await harness.server.pluginService.reload(plugin.id);
      const created = await createReadyHostThread(harness, {
        projectId: project.id,
        providerId: "fake-beta",
        execution,
        workspace: { type: "unmanaged", path: harness.repoDir },
      });
      expect(await getThreadOutput(harness.api, created.thread.id)).toContain(
        "READY",
      );
      const starts = (await record.read()).filter(
        (request) => request.method === "thread/start",
      );
      expect(starts).toHaveLength(1);
      expect(starts[0]?.params).toMatchObject({
        executionIntegration: { id: integrationId, providerId: "fake-beta" },
        options: {
          providerOptions: {
            executionOwner: "integration",
            model: "fake-model",
          },
        },
      });
    });
  } finally {
    await record.dispose();
    await fixtureFiles.cleanup();
  }
}, 90_000);

it("retries failed turns through the same integration and blocks retry while it is disabled", async () => {
  const record = await recordScriptedEchoRequests();
  const fixtureFiles = await createExecutionIntegrationFixture();
  try {
    await withHarness(async (harness) => {
      const plugin = await harness.server.pluginService.installPath(
        fixtureFiles.root,
      );
      expect(plugin.status, plugin.statusDetail ?? "").toBe("running");
      const project = await createProjectFixture(harness, {
        name: "Execution retry",
      });
      await bind(harness);
      const created = await createReadyHostThread(harness, {
        projectId: project.id,
        providerId: "fake-alpha",
        execution,
        workspace: { type: "unmanaged", path: harness.repoDir },
      });
      await sendTextMessage(harness.api, created.thread.id, {
        text: "fail_turn:Service_unavailable",
        execution,
      });
      await waitForThreadStatus(
        harness.api,
        created.thread.id,
        "error",
        15_000,
      );
      const before = (await record.read()).filter(
        (request) => request.method === "turn/start",
      ).length;
      await harness.server.pluginService.setEnabled(plugin.id, false);
      const read = await fetch(
        `${harness.serverUrl}/api/v1/threads/${created.thread.id}`,
      );
      expect(read.status).toBe(200);
      const blocked = await fetch(
        `${harness.serverUrl}/api/v1/threads/${created.thread.id}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(blocked.status, await blocked.clone().text()).toBe(409);
      expect(
        (await record.read()).filter(
          (request) => request.method === "turn/start",
        ),
      ).toHaveLength(before);
      await harness.server.pluginService.setEnabled(plugin.id, true);
      const retry = await fetch(
        `${harness.serverUrl}/api/v1/threads/${created.thread.id}/retry`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(retry.status, await retry.clone().text()).toBe(200);
      await expect
        .poll(
          async () =>
            (await record.read()).filter(
              (request) => request.method === "turn/start",
            ).length,
        )
        .toBe(before + 1);
      const retried = (await record.read())
        .filter((request) => request.method === "turn/start")
        .at(-1);
      expect(retried?.params).toMatchObject({
        executionIntegration: { id: integrationId, providerId: "fake-alpha" },
        options: {
          model: "fake-model",
          providerOptions: { executionOwner: "integration" },
        },
      });
      await waitForThreadStatus(
        harness.api,
        created.thread.id,
        "error",
        15_000,
      );
    });
  } finally {
    await record.dispose();
    await fixtureFiles.cleanup();
  }
}, 90_000);
