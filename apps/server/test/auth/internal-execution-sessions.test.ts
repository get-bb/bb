import { describe, expect, it } from "vitest";
import type { PolicyAction, PolicyResource } from "@bb/domain";
import {
  InternalExecutionSessionError,
  PLUGIN_BACKGROUND_PRINCIPAL_DISPLAY_NAME,
  THREAD_AGENT_PRINCIPAL_DISPLAY_NAME,
  createInternalExecutionSessions,
} from "../../src/auth/internal-execution-sessions.js";

const THREAD_ID = "thread_abc";
const PROJECT_ID = "project_xyz";
const PLUGIN_ID = "workflows";

function action(name: string): PolicyAction {
  return { name };
}

function resource(kind: string, id: string | null): PolicyResource {
  return { kind, id };
}

describe("createInternalExecutionSessions", () => {
  it("rejects invalid modes and constructor inputs", () => {
    expect(() =>
      createInternalExecutionSessions({
        mode: "local-owner " as "local-owner",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      createInternalExecutionSessions({
        mode: "work-together-memory" as "work-together",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() => createInternalExecutionSessions(null as never)).toThrow(
      InternalExecutionSessionError,
    );

    const sessions = createInternalExecutionSessions({ mode: "local-owner" });
    expect(() =>
      sessions.createPluginBackgroundSession({
        pluginId: "",
        callbackCategory: "service",
        callbackName: "tick",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createPluginBackgroundSession({
        pluginId: " plug",
        callbackCategory: "service",
        callbackName: "tick",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createPluginBackgroundSession({
        pluginId: "a/b",
        callbackCategory: "service",
        callbackName: "tick",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createPluginBackgroundSession({
        pluginId: PLUGIN_ID,
        callbackCategory: "cron" as "service",
        callbackName: "tick",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createPluginBackgroundSession({
        pluginId: PLUGIN_ID,
        callbackCategory: "service",
        callbackName: "",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createThreadAgentSession({
        threadId: THREAD_ID,
        projectId: "../project",
      }),
    ).toThrow(InternalExecutionSessionError);
    expect(() =>
      sessions.createThreadAgentSession({
        threadId: "",
        projectId: PROJECT_ID,
      }),
    ).toThrow(InternalExecutionSessionError);
  });

  it("mints immutable deterministic plugin-background Principals", () => {
    const sessions = createInternalExecutionSessions({ mode: "local-owner" });
    const first = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "schedule",
      callbackName: "nightly",
    });
    const second = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "schedule",
      callbackName: "nightly",
    });
    const other = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "service",
      callbackName: "nightly",
    });

    expect(first.principal).toEqual({
      id: "system:plugin-background/workflows/schedule/nightly",
      kind: "system",
      displayName: PLUGIN_BACKGROUND_PRINCIPAL_DISPLAY_NAME,
    });
    expect(first.principal).toEqual(second.principal);
    expect(other.principal.id).not.toBe(first.principal.id);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.principal)).toBe(true);
    expect(() => {
      (first.principal as { kind: string }).kind = "human";
    }).toThrow();
    expect(first.principal.kind).toBe("system");
  });

  it("accepts canonical thread-event callback names with dots", () => {
    const sessions = createInternalExecutionSessions({ mode: "local-owner" });
    const session = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "thread-event",
      callbackName: "thread.created",
    });
    expect(session.principal.id).toBe(
      "system:plugin-background/workflows/thread-event/thread.created",
    );
  });

  it("mints immutable deterministic thread-agent Principals with closed project scope", async () => {
    const sessions = createInternalExecutionSessions({
      mode: "work-together",
    });
    const session = sessions.createThreadAgentSession({
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
    });

    expect(session.principal).toEqual({
      id: `agent:thread/${THREAD_ID}`,
      kind: "agent",
      displayName: THREAD_AGENT_PRINCIPAL_DISPLAY_NAME,
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.principal)).toBe(true);

    await expect(
      session.authorize(
        action("publicHttp.projects.get"),
        resource("project", PROJECT_ID),
      ),
    ).resolves.toEqual({ allowed: true });
    await expect(
      session.authorize(
        action("publicHttp.projects.get"),
        resource("project", "other_project"),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });

  it("explicitly allows all in local-owner for system and agent sessions", async () => {
    const sessions = createInternalExecutionSessions({ mode: "local-owner" });
    const system = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "thread-event",
      callbackName: "onCreated",
    });
    const agent = sessions.createThreadAgentSession({
      threadId: THREAD_ID,
      projectId: PROJECT_ID,
    });

    await expect(
      system.authorize(
        action("publicHttp.threads.stop"),
        resource("thread", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: true });
    await expect(
      agent.authorize(
        action("publicHttp.projects.list"),
        resource("project", null),
      ),
    ).resolves.toEqual({ allowed: true });
    await expect(
      agent.authorize(
        action("not.a.registry.action"),
        resource("thread", null),
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("intentionally denies every action for work-together plugin background", async () => {
    const sessions = createInternalExecutionSessions({
      mode: "work-together",
    });
    const system = sessions.createPluginBackgroundSession({
      pluginId: PLUGIN_ID,
      callbackCategory: "service",
      callbackName: "run",
    });

    await expect(
      system.authorize(
        action("publicHttp.threads.get"),
        resource("thread", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      system.authorize(
        action("publicHttp.system.version"),
        resource("systemSettings", null),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      system.authorize(action("publicHttp.unmapped"), resource("route", null)),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });
});

describe("work-together thread agent authorization", () => {
  const sessions = createInternalExecutionSessions({ mode: "work-together" });
  const agent = sessions.createThreadAgentSession({
    threadId: THREAD_ID,
    projectId: PROJECT_ID,
  });

  const allowedThreadOps = [
    "get",
    "childSummary",
    "send",
    "interactions",
    "interaction",
    "timeline",
    "conversationOutline",
    "timelineTurnSummaryDetails",
    "output",
    "events",
    "eventWait",
    "defaultExecutionOptions",
    "storageFiles",
    "storageFile",
    "storagePaths",
    "storageContent",
    "worktreeFile",
  ] as const;

  const allowedProjectOps = [
    "get",
    "defaultExecutionOptions",
    "promptHistory",
    "files",
    "fileContent",
    "paths",
    "commands",
    "skills",
    "skillContent",
    "skillFiles",
    "branches",
    "attachmentContent",
  ] as const;

  it("allows every exact-thread allowlisted operation", async () => {
    for (const op of allowedThreadOps) {
      await expect(
        agent.authorize(
          action(`publicHttp.threads.${op}`),
          resource("thread", THREAD_ID),
        ),
      ).resolves.toEqual({ allowed: true });
    }
  });

  it("allows every exact-project allowlisted operation", async () => {
    for (const op of allowedProjectOps) {
      await expect(
        agent.authorize(
          action(`publicHttp.projects.${op}`),
          resource("project", PROJECT_ID),
        ),
      ).resolves.toEqual({ allowed: true });
    }
  });

  it("allows every unscoped system-settings allowlisted operation", async () => {
    for (const op of ["providers", "executionOptions", "version"] as const) {
      await expect(
        agent.authorize(
          action(`publicHttp.system.${op}`),
          resource("systemSettings", null),
        ),
      ).resolves.toEqual({ allowed: true });
    }
    await expect(
      agent.authorize(
        action("publicHttp.system.providerLogo"),
        resource("systemSettings", "provider_1"),
      ),
    ).resolves.toEqual({ allowed: true });
  });

  it("rejects wrong id, kind, and null resource targets", async () => {
    await expect(
      agent.authorize(
        action("publicHttp.threads.get"),
        resource("thread", "other_thread"),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        action("publicHttp.threads.get"),
        resource("project", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        action("publicHttp.threads.get"),
        resource("thread", null),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        action("publicHttp.projects.get"),
        resource("project", null),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        action("publicHttp.system.version"),
        resource("systemSettings", "not-null"),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });

  it("rejects sensitive negatives and collection creates", async () => {
    const denied: Array<{ action: string; resource: PolicyResource }> = [
      {
        action: "publicHttp.threads.stop",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.delete",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.archive",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.fork",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.respondToInteraction",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.createQueuedMessage",
        resource: resource("thread", THREAD_ID),
      },
      {
        action: "publicHttp.threads.create",
        resource: resource("thread", null),
      },
      {
        action: "publicHttp.threads.list",
        resource: resource("thread", null),
      },
      {
        action: "publicHttp.projects.create",
        resource: resource("project", null),
      },
      {
        action: "publicHttp.projects.list",
        resource: resource("project", null),
      },
      {
        action: "publicHttp.projects.search",
        resource: resource("project", null),
      },
      {
        action: "publicHttp.projects.uploadAttachment",
        resource: resource("project", PROJECT_ID),
      },
      {
        action: "publicHttp.system.voiceTranscription",
        resource: resource("systemSettings", null),
      },
      {
        action: "publicHttp.plugins.list",
        resource: resource("plugin", null),
      },
      {
        action: "publicHttp.plugins.settingsGet",
        resource: resource("plugin", PLUGIN_ID),
      },
      {
        action: "operator.raw",
        resource: resource("systemSettings", null),
      },
    ];

    for (const entry of denied) {
      await expect(
        agent.authorize(action(entry.action), entry.resource),
      ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    }
  });

  it("rejects forged registry lookalikes and malformed action/resource shapes", async () => {
    await expect(
      agent.authorize(
        action("publicHttp.threads.get "),
        resource("thread", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(action("threads.get"), resource("thread", THREAD_ID)),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        action("publicHttp.unmapped"),
        resource("thread", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(
        { name: "publicHttp.threads.get", extra: true } as PolicyAction,
        resource("thread", THREAD_ID),
      ),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(action("publicHttp.threads.get"), {
        kind: "thread",
        id: THREAD_ID,
        extra: true,
      } as PolicyResource),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
    await expect(
      agent.authorize(action("publicHttp.threads.get"), {
        kind: "thread",
        id: "",
      }),
    ).resolves.toEqual({ allowed: false, reason: "forbidden" });
  });
});
