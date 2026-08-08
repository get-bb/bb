import { upsertProjectExecutionDefaults } from "@bb/db";
import { threadScope } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { threadResponseSchema } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTestProviderSupportsSessionImportOverrides,
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
  setTestProviderSupportsSessionImport,
  waitForQueuedCommand,
} from "../helpers/commands.js";
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

function seedSecondImportProject(
  harness: TestAppHarness,
  args: { hostId: string; path: string; providerId?: string; model?: string },
) {
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: args.hostId,
    path: args.path,
  });
  seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: project.id,
    path: args.path,
  });
  upsertProjectExecutionDefaults(harness.deps.db, {
    projectId: project.id,
    providerId: args.providerId ?? "acp-omp",
    model: args.model ?? "omp/default",
    reasoningLevel: "medium",
    permissionMode: "full",
    serviceTier: "default",
  });
  return { project };
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
  afterEach(() => {
    clearTestProviderSupportsSessionImportOverrides();
  });

  it("imports an external ACP session bound to the project source", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-1",
        hostId: host.id,
        cwd: SOURCE_PATH,
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

  it("refuses an import request with no cwd", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-no-cwd",
        hostId: host.id,
      });

      // cwd is a required assertion, not a defaulted field: bb cannot read
      // the external session's actual working directory back from it.
      expect(response.status).toBe(400);
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
        cwd: SOURCE_PATH,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(JSON.stringify(body)).toContain("does not support session import");
    });
  });

  it("refuses importing a provider session another live thread already binds", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);
      const providerSessionId = "external-omp-session-shared";

      const firstResponse = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId,
        hostId: host.id,
        cwd: SOURCE_PATH,
      });
      expect(firstResponse.status).toBe(201);
      const firstThread = threadResponseSchema.parse(
        await readJson(firstResponse),
      );

      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === firstThread.id,
      );
      const sessionId = startCommand.row.sessionId;
      if (!sessionId) {
        throw new Error("Queued thread start is missing sessionId");
      }
      // The bridge records the binding by sending thread/identity once the
      // agent accepts session/load; that's what the reverse lookup relies on.
      const eventResponse = await harness.app.request(
        "/internal/session/events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId,
            eventGroups: groupHostDaemonEvents([
              createTestDaemonEventEnvelope({
                event: {
                  type: "thread/identity",
                  threadId: firstThread.id,
                  providerThreadId: providerSessionId,
                  scope: threadScope(),
                },
              }),
            ]),
          }),
        },
      );
      expect(eventResponse.status).toBe(200);

      const secondResponse = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId,
        hostId: host.id,
        cwd: SOURCE_PATH,
      });

      expect(secondResponse.status).toBe(409);
      const body = await readJson(secondResponse);
      expect(body).toMatchObject({ code: "provider_session_already_bound" });
      expect(JSON.stringify(body)).toContain(firstThread.id);
    });
  });

  it("lets exactly one of two concurrent imports into different project workspaces claim a session", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);
      const OTHER_SOURCE_PATH = "/tmp/public-thread-import-concurrent";
      const { project: otherProject } = seedSecondImportProject(harness, {
        hostId: host.id,
        path: OTHER_SOURCE_PATH,
      });
      const providerSessionId = "external-omp-session-raced";

      // Neither thread's start has completed, so no thread/identity event
      // exists for either; the event-log reverse lookup alone would admit
      // both. Only the reservation claimed inside the thread-create
      // transaction serializes them.
      const [first, second] = await Promise.all([
        postImport(harness, {
          projectId: project.id,
          providerId: "acp-omp",
          providerSessionId,
          hostId: host.id,
          cwd: SOURCE_PATH,
        }),
        postImport(harness, {
          projectId: otherProject.id,
          providerId: "acp-omp",
          providerSessionId,
          hostId: host.id,
          cwd: OTHER_SOURCE_PATH,
        }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const winner = first.status === 201 ? first : second;
      const loser = first.status === 201 ? second : first;
      const winnerThread = threadResponseSchema.parse(await readJson(winner));
      const body = await readJson(loser);
      expect(body).toMatchObject({ code: "provider_session_already_bound" });
      expect(JSON.stringify(body)).toContain(winnerThread.id);
    });
  });

  it("refuses a second import of a claimed session even before its start records identity", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);
      const OTHER_SOURCE_PATH = "/tmp/public-thread-import-unstarted";
      const { project: otherProject } = seedSecondImportProject(harness, {
        hostId: host.id,
        path: OTHER_SOURCE_PATH,
      });
      const providerSessionId = "external-omp-session-unstarted";

      const firstResponse = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId,
        hostId: host.id,
        cwd: SOURCE_PATH,
      });
      expect(firstResponse.status).toBe(201);
      const firstThread = threadResponseSchema.parse(
        await readJson(firstResponse),
      );

      // Deliberately no thread/identity event: the first thread's start is
      // still in flight, which is exactly the window where the event-log
      // check alone let a duplicate through.
      const secondResponse = await postImport(harness, {
        projectId: otherProject.id,
        providerId: "acp-omp",
        providerSessionId,
        hostId: host.id,
        cwd: OTHER_SOURCE_PATH,
      });

      expect(secondResponse.status).toBe(409);
      const body = await readJson(secondResponse);
      expect(body).toMatchObject({ code: "provider_session_already_bound" });
      expect(JSON.stringify(body)).toContain(firstThread.id);
    });
  });

  it("allows the same session id under a different provider on the same host", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);
      const OTHER_SOURCE_PATH = "/tmp/public-thread-import-cross-provider";
      const { project: otherProject } = seedSecondImportProject(harness, {
        hostId: host.id,
        path: OTHER_SOURCE_PATH,
        providerId: "acp-opencode",
        model: "opencode/default",
      });
      // Session ids live in a provider namespace: "abc" on acp-omp and "abc"
      // on acp-opencode are unrelated sessions.
      const providerSessionId = "abc";

      const firstResponse = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId,
        hostId: host.id,
        cwd: SOURCE_PATH,
      });
      expect(firstResponse.status).toBe(201);
      const firstThread = threadResponseSchema.parse(
        await readJson(firstResponse),
      );

      // Record the acp-omp binding the way the bridge does, so the
      // event-log reverse lookup is exercised too, not just the reservation.
      const startCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === firstThread.id,
      );
      const sessionId = startCommand.row.sessionId;
      if (!sessionId) {
        throw new Error("Queued thread start is missing sessionId");
      }
      const eventResponse = await harness.app.request(
        "/internal/session/events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId,
            eventGroups: groupHostDaemonEvents([
              createTestDaemonEventEnvelope({
                event: {
                  type: "thread/identity",
                  threadId: firstThread.id,
                  providerThreadId: providerSessionId,
                  scope: threadScope(),
                },
              }),
            ]),
          }),
        },
      );
      expect(eventResponse.status).toBe(200);

      const secondResponse = await postImport(harness, {
        projectId: otherProject.id,
        providerId: "acp-opencode",
        providerSessionId,
        hostId: host.id,
        cwd: OTHER_SOURCE_PATH,
      });

      expect(secondResponse.status).toBe(201);
      const secondThread = threadResponseSchema.parse(
        await readJson(secondResponse),
      );
      expect(secondThread.providerId).toBe("acp-opencode");
    });
  });

  it("refuses importing when the agent's live handshake reports no session/load support", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedImportTarget(harness);
      // Static ACP_CAPABILITIES advertises supportsSessionImport for every
      // acp-* provider; this simulates the agent's own live `initialize`
      // handshake (agentCapabilities.loadSession) reporting otherwise, which
      // must override the static family-level constant.
      setTestProviderSupportsSessionImport("acp-omp", false);

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-no-load",
        hostId: host.id,
        cwd: SOURCE_PATH,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(body)).toContain("does not support session/load");
    });
  });

  it("refuses importing a purely custom ACP agent whose live handshake reports no session/load support", async () => {
    // Unlike acp-omp, "acp-mycoder" has no KNOWN_ACP_AGENTS entry: the
    // capability gate can only probe it at all if it resolves the launch
    // spec through the configured custom agent (the same resolution
    // thread.start uses), not the built-in-only lookup. Without that, this
    // provider would skip the live probe entirely and fall back to the
    // static ACP-family allow, silently admitting the import.
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "mycoder",
            displayName: "My Coder",
            command: "mycoder-agent",
            args: ["acp"],
            env: {},
          },
        ],
      },
      async (harness) => {
        const { host, project } = seedImportTarget(harness);
        setTestProviderSupportsSessionImport("acp-mycoder", false);

        const response = await postImport(harness, {
          projectId: project.id,
          providerId: "acp-mycoder",
          providerSessionId: "external-mycoder-session-no-load",
          hostId: host.id,
          cwd: SOURCE_PATH,
        });

        expect(response.status).toBe(400);
        const body = await readJson(response);
        expect(body).toMatchObject({ code: "invalid_request" });
        expect(JSON.stringify(body)).toContain(
          "does not support session/load",
        );
      },
    );
  });

  it("imports a workspace whose path differs from the project source", async () => {
    await withTestHarness(async (harness) => {
      const WORKSPACE_PATH = "/tmp/public-thread-import-workspace";
      const { host, project } = seedImportTarget(harness);
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKSPACE_PATH,
      });

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-workspace",
        hostId: host.id,
        cwd: WORKSPACE_PATH,
      });

      expect(response.status).toBe(201);
      const thread = threadResponseSchema.parse(await readJson(response));
      expect(thread).toMatchObject({
        projectId: project.id,
        providerId: "acp-omp",
        status: "starting",
      });
    });
  });

  it("refuses a cwd matching a workspace that belongs to a different project", async () => {
    await withTestHarness(async (harness) => {
      const OTHER_PROJECT_WORKSPACE_PATH =
        "/tmp/public-thread-import-other-project-workspace";
      const { host, project } = seedImportTarget(harness);
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/public-thread-import-other-project-source",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: otherProject.id,
        path: OTHER_PROJECT_WORKSPACE_PATH,
      });

      const response = await postImport(harness, {
        projectId: project.id,
        providerId: "acp-omp",
        providerSessionId: "external-omp-session-cross-project",
        hostId: host.id,
        cwd: OTHER_PROJECT_WORKSPACE_PATH,
      });

      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(body).toMatchObject({ code: "invalid_request" });
      expect(JSON.stringify(body)).toContain(
        "does not match the project source",
      );
    });
  });
});
