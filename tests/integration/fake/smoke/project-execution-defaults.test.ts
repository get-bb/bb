import { getProjectExecutionDefaults } from "@bb/db";
import type { CreateThreadRequest } from "@bb/server-contract";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { waitForThreadStatus } from "../../helpers/assertions.js";
import {
  recordScriptedEchoRequests,
  type ScriptedEchoRecordedRequest,
} from "../../helpers/scripted-echo.js";
import { withHarness, type IntegrationHarness } from "../../helpers/harness.js";
import { createProjectFixture, DEFAULT_TIMEOUT_MS } from "./shared.js";

type ExecutionSettings = Required<
  Pick<
    CreateThreadRequest,
    "model" | "serviceTier" | "reasoningLevel" | "permissionMode"
  >
>;

interface CreateThreadOptions {
  environment: CreateThreadRequest["environment"];
  execution?: ExecutionSettings;
  origin: CreateThreadRequest["origin"];
  projectId: string;
  providerId?: string;
}

const APP_A_SETTINGS: ExecutionSettings = {
  model: "fake-model",
  reasoningLevel: "high",
  permissionMode: "full",
  serviceTier: "fast",
};

const APP_B_SETTINGS: ExecutionSettings = {
  model: "fake-model",
  reasoningLevel: "low",
  permissionMode: "accept-edits",
  serviceTier: "default",
};

const CHANGED_SETTINGS: ExecutionSettings = {
  model: "fake-model",
  reasoningLevel: "medium",
  permissionMode: "auto",
  serviceTier: "fast",
};

function hostWorkspace(
  harness: IntegrationHarness,
): CreateThreadRequest["environment"] {
  return {
    type: "host",
    hostId: harness.hostId,
    workspace: { type: "unmanaged", path: harness.repoDir },
  };
}

async function createReadyThread(
  harness: IntegrationHarness,
  options: CreateThreadOptions,
): Promise<ReturnType<typeof threadSchema.parse>> {
  const response = await harness.api.threads.$post({
    json: {
      projectId: options.projectId,
      origin: options.origin,
      input: [
        {
          type: "text",
          text: "Reply with exactly READY and nothing else.",
          mentions: [],
        },
      ],
      environment: options.environment,
      startedOnBehalfOf: null,
      originKind: null,
      ...(options.providerId === undefined
        ? {}
        : { providerId: options.providerId }),
      ...(options.execution ?? {}),
    },
  });
  if (response.status !== 201) {
    throw new Error(
      `create thread failed with ${response.status}: ${await response.text()}`,
    );
  }
  const created = threadSchema.parse(await response.json());
  return waitForThreadStatus(
    harness.api,
    created.id,
    "idle",
    DEFAULT_TIMEOUT_MS,
  );
}

function findThreadStart(
  requests: readonly ScriptedEchoRecordedRequest[],
  threadId: string,
): ScriptedEchoRecordedRequest {
  const request = requests.find(
    (entry) =>
      entry.method === "thread/start" && entry.params?.threadId === threadId,
  );
  if (!request) {
    throw new Error(
      `No fake provider thread/start was recorded for ${threadId}`,
    );
  }
  return request;
}

function expectThreadStartSettings(
  requests: readonly ScriptedEchoRecordedRequest[],
  threadId: string,
  settings: ExecutionSettings,
): void {
  expect(findThreadStart(requests, threadId).params).toMatchObject({
    options: settings,
  });
}

describe.sequential("fake provider project execution defaults integration", () => {
  it("keeps provider settings scoped while remembering the last app provider", async () => {
    const record = await recordScriptedEchoRequests();
    try {
      await withHarness(async (harness) => {
        const project = await createProjectFixture(
          harness,
          "Provider Execution Defaults Smoke",
        );

        const firstA = await createReadyThread(harness, {
          environment: hostWorkspace(harness),
          execution: APP_A_SETTINGS,
          origin: "app",
          projectId: project.id,
          providerId: "fake-alpha",
        });
        expect(firstA.providerId).toBe("fake-alpha");
        expectThreadStartSettings(
          await record.read(),
          firstA.id,
          APP_A_SETTINGS,
        );

        const firstB = await createReadyThread(harness, {
          environment: hostWorkspace(harness),
          execution: APP_B_SETTINGS,
          origin: "app",
          projectId: project.id,
          providerId: "fake-beta",
        });
        expect(firstB.providerId).toBe("fake-beta");
        expectThreadStartSettings(
          await record.read(),
          firstB.id,
          APP_B_SETTINGS,
        );
        expect(
          getProjectExecutionDefaults(harness.db, {
            projectId: project.id,
            providerId: "fake-alpha",
          }),
        ).toEqual({ providerId: "fake-alpha", ...APP_A_SETTINGS });
        expect(
          getProjectExecutionDefaults(harness.db, {
            projectId: project.id,
            providerId: "fake-beta",
          }),
        ).toEqual({ providerId: "fake-beta", ...APP_B_SETTINGS });

        const explicitA = await createReadyThread(harness, {
          environment: hostWorkspace(harness),
          origin: "app",
          projectId: project.id,
          providerId: "fake-alpha",
        });
        expect(explicitA.providerId).toBe("fake-alpha");
        expectThreadStartSettings(
          await record.read(),
          explicitA.id,
          APP_A_SETTINGS,
        );
        expect(
          getProjectExecutionDefaults(harness.db, { projectId: project.id }),
        ).toEqual({ providerId: "fake-alpha", ...APP_A_SETTINGS });

        const omittedProvider = await createReadyThread(harness, {
          environment: hostWorkspace(harness),
          origin: "app",
          projectId: project.id,
        });
        expect(omittedProvider.providerId).toBe("fake-alpha");
        expectThreadStartSettings(
          await record.read(),
          omittedProvider.id,
          APP_A_SETTINGS,
        );

        await createReadyThread(harness, {
          environment: hostWorkspace(harness),
          execution: CHANGED_SETTINGS,
          origin: "cli",
          projectId: project.id,
          providerId: "fake-beta",
        });
        expect(
          getProjectExecutionDefaults(harness.db, {
            projectId: project.id,
            providerId: "fake-beta",
          }),
        ).toEqual({ providerId: "fake-beta", ...APP_B_SETTINGS });
        expect(
          getProjectExecutionDefaults(harness.db, { projectId: project.id }),
        ).toEqual({ providerId: "fake-alpha", ...APP_A_SETTINGS });

        if (!firstA.environmentId) {
          throw new Error(
            "Expected the first provider A thread to have an environment",
          );
        }
        await createReadyThread(harness, {
          environment: {
            type: "reuse",
            environmentId: firstA.environmentId,
          },
          execution: CHANGED_SETTINGS,
          origin: "app",
          projectId: project.id,
          providerId: "fake-beta",
        });
        expect(
          getProjectExecutionDefaults(harness.db, {
            projectId: project.id,
            providerId: "fake-beta",
          }),
        ).toEqual({ providerId: "fake-beta", ...APP_B_SETTINGS });
      });
    } finally {
      await record.dispose();
    }
  });
});
