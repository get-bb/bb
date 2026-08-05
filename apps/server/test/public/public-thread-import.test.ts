import { upsertProjectExecutionDefaults } from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const SOURCE_PATH = "/tmp/public-thread-import";

function seedImportTarget(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: SOURCE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: SOURCE_PATH,
  });
  // Stored defaults keep the create flow off the live model-catalog probe.
  upsertProjectExecutionDefaults(harness.deps.db, {
    projectId: project.id,
    providerId: "acp-omp",
    model: "omp/default",
    reasoningLevel: "medium",
    permissionMode: "full",
    serviceTier: "default",
  });
  return { environment, host, project };
}

async function postImport(
  harness: TestAppHarness,
  body: Record<string, unknown>,
) {
  return harness.app.request("/api/v1/threads/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public thread import route", () => {
  it("imports an external ACP session bound to the project source", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-1",
        hostId: host.id,
      });

      expect(response.status).toBe(201);
      const thread = threadResponseSchema.parse(await readJson(response));
      expect(thread).toMatchObject({
        projectId: project.id,
        providerId: "acp-omp",
        status: "starting",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual([]);
      expect(queued.command.fork).toBeUndefined();
      expect(queued.command.sessionImport).toEqual({
        providerThreadId: "external-omp-session-1",
      });
    });
  });

  it("refuses a cwd matching neither the project source nor a project workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-2",
        hostId: host.id,
        cwd: "/tmp/somewhere-else-entirely",
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(body)).toContain(
        "does not match the project source",
      );
    });
  });

  it("refuses providers without session import support", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "codex",
        providerSessionId: "external-codex-session",
        hostId: host.id,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain(
        "does not support session import",
      );
    });
  });
});
