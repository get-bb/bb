/**
 * Extension payloads are validated at ingest against the owning plugin's
 * declared schema. A passing payload persists as the extension item or
 * thread-state event the daemon sent; an undeclared kind, a schema miss, or
 * an oversized payload persists as a visible `provider/unhandled` in the same
 * batch slot instead of being dropped or stored unvalidated.
 */
import { eq } from "drizzle-orm";
import { events } from "@bb/db";
import { threadScope, turnScope, type ExtensionKind } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EXTENSION_PAYLOAD_MAX_BYTES } from "../../src/internal/extension-payloads.js";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

const PLUGIN_ID = "provider-widgets";
const PROVIDER_ID = "widgets";
const GOAL_KIND = `${PLUGIN_ID}/goal` as const;
const PRESENTATION = {
  label: { pending: "Updating goal", completed: "Goal updated" },
  icon: { glyph: "Target" },
};

async function setup() {
  const harness = await createTestAppHarness();
  // A provider plugin that declares one extension kind with both surfaces:
  // `goal` items carry an objective, `goal` state carries a status.
  harness.deps.providerRegistry.register({
    ...buildPluginProviderRegistration({
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration({
        id: PROVIDER_ID,
        displayName: "Widgets",
        capabilities: {
          experimental_providerHealth: false,
          experimental_providerUsage: false,
          experimental_providerInstallation: false,
          supportsServiceTier: false,
          supportsNativeUserQuestion: false,
          fork: "none",
          supportsManualCompaction: false,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ["full"],
          reasoningLevels: ["medium"],
        },
        composerActions: [],
        experimental_extensionKinds: {
          goal: {
            item: z.object({ objective: z.string().min(1) }),
            state: z.object({ status: z.enum(["active", "done"]) }),
          },
        },
      }),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
  });
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: PROVIDER_ID,
    status: "active",
  });
  return { harness, session, thread };
}

async function post(
  harness: TestAppHarness,
  sessionId: string,
  batch: HostDaemonEventEnvelope[],
): Promise<Response> {
  return harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId,
      eventGroups: groupHostDaemonEvents(batch),
    }),
  });
}

function storedRows(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select({
      type: events.type,
      itemKind: events.itemKind,
      scopeKind: events.scopeKind,
      turnId: events.turnId,
      data: events.data,
    })
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all()
    .map((row) => ({
      type: row.type,
      itemKind: row.itemKind,
      scopeKind: row.scopeKind,
      turnId: row.turnId,
      data: JSON.parse(row.data) as unknown,
    }));
}

function extensionItemEvent(
  threadId: string,
  payload: unknown,
  kind: ExtensionKind = GOAL_KIND,
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "item/started",
      threadId,
      providerThreadId: "prov-1",
      scope: turnScope("turn-1"),
      item: {
        type: "extension",
        id: "item-1",
        kind,
        // The wire envelope is parsed by the route; an invalid payload shape
        // must still be a JSON value to reach the validator at all.
        payload: payload as never,
        status: "pending",
        presentation: PRESENTATION,
        parentToolCallId: "parent-1",
      },
    },
  };
}

function turnStarted(threadId: string): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "turn/started",
      threadId,
      providerThreadId: "prov-1",
      scope: turnScope("turn-1"),
    },
  };
}

describe("extension payload ingest validation", () => {
  it("persists an extension item and state whose payloads match the declared schemas", async () => {
    const { harness, session, thread } = await setup();
    try {
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        extensionItemEvent(thread.id, { objective: "Ship it" }),
        {
          threadId: thread.id,
          event: {
            type: "thread/extensionState/updated",
            threadId: thread.id,
            providerThreadId: "prov-1",
            scope: threadScope(),
            kind: GOAL_KIND,
            payload: { status: "active" },
          },
        },
      ]);
      expect(response.status).toBe(200);
      expect(storedRows(harness, thread.id)).toMatchObject([
        { type: "turn/started" },
        {
          type: "item/started",
          itemKind: "extension",
          data: {
            item: { kind: GOAL_KIND, payload: { objective: "Ship it" } },
          },
        },
        {
          type: "thread/extensionState/updated",
          data: { kind: GOAL_KIND, payload: { status: "active" } },
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("replaces a schema miss with provider/unhandled in the same batch slot", async () => {
    const { harness, session, thread } = await setup();
    try {
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        extensionItemEvent(thread.id, { objective: 42 }),
        {
          threadId: thread.id,
          event: {
            type: "thread/extensionState/updated",
            threadId: thread.id,
            providerThreadId: "prov-1",
            scope: threadScope(),
            kind: GOAL_KIND,
            payload: { status: "paused" },
          },
        },
      ]);
      expect(response.status).toBe(200);
      // Both slots were accepted: the replacement keeps the batch shape.
      await expect(readJson(response)).resolves.toMatchObject({
        acceptedEvents: [
          { eventIndex: 0 },
          { eventIndex: 1 },
          { eventIndex: 2 },
        ],
        rejectedEvents: [],
      });
      const rows = storedRows(harness, thread.id);
      expect(rows.map((row) => row.type)).toEqual([
        "turn/started",
        "provider/unhandled",
        "provider/unhandled",
      ]);
      expect(rows[1]).toMatchObject({
        itemKind: null,
        // The row keeps the original scope and parent.
        scopeKind: "turn",
        turnId: "turn-1",
        data: {
          providerId: PROVIDER_ID,
          rawType: `extension/item:${GOAL_KIND}`,
          rawEvent: {
            method: "item/started",
            params: {
              kind: GOAL_KIND,
              payload: { objective: 42 },
              reason: expect.stringContaining("objective"),
            },
          },
          parentToolCallId: "parent-1",
        },
      });
      expect(rows[2]).toMatchObject({
        scopeKind: "thread",
        turnId: null,
        data: {
          rawType: `extension/state:${GOAL_KIND}`,
          rawEvent: { method: "thread/extensionState/updated" },
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects an undeclared kind, a declared kind with no schema for the surface, and an oversized payload", async () => {
    const { harness, session, thread } = await setup();
    try {
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        // No plugin "provider-nobody" is registered.
        extensionItemEvent(
          thread.id,
          { objective: "x" },
          "provider-nobody/goal",
        ),
        // The plugin is registered but declares no "widget" kind.
        extensionItemEvent(
          thread.id,
          { objective: "x" },
          `${PLUGIN_ID}/widget`,
        ),
        // Declared, schema-valid, but past the size cap.
        extensionItemEvent(thread.id, {
          objective: "x".repeat(EXTENSION_PAYLOAD_MAX_BYTES + 1),
        }),
      ]);
      expect(response.status).toBe(200);
      const rows = storedRows(harness, thread.id);
      expect(rows.map((row) => row.type)).toEqual([
        "turn/started",
        "provider/unhandled",
        "provider/unhandled",
        "provider/unhandled",
      ]);
      expect(rows.slice(1).map((row) => row.data)).toMatchObject([
        {
          rawEvent: {
            params: { reason: expect.stringContaining("declares no") },
          },
        },
        {
          rawEvent: {
            params: { reason: expect.stringContaining("declares no") },
          },
        },
        {
          rawEvent: {
            params: { reason: expect.stringContaining("bytes; the limit is") },
          },
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("stops accepting a kind once its plugin's registration is disposed", async () => {
    const { harness, session, thread } = await setup();
    try {
      const registration = harness.deps.providerRegistry.get(PROVIDER_ID);
      expect(registration?.extensionKinds.goal?.item).toBeDefined();
      expect(
        harness.deps.providerRegistry.getExtensionKindSchemas(GOAL_KIND),
      ).toBe(registration?.extensionKinds.goal);
      // Re-register under a fresh handle so the test owns the disposer.
      const handle = harness.deps.providerRegistry.register({
        info: { ...registration!.info, id: "widgets-2" },
        serverCapabilities: registration!.serverCapabilities,
        extensionKinds: {
          badge: { item: z.object({ text: z.string() }) },
        },
        pluginId: PLUGIN_ID,
      });
      expect(
        harness.deps.providerRegistry.getExtensionKindSchemas(
          `${PLUGIN_ID}/badge`,
        ),
      ).not.toBeNull();
      handle.dispose();
      expect(
        harness.deps.providerRegistry.getExtensionKindSchemas(
          `${PLUGIN_ID}/badge`,
        ),
      ).toBeNull();

      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        extensionItemEvent(thread.id, { text: "hi" }, `${PLUGIN_ID}/badge`),
      ]);
      expect(response.status).toBe(200);
      expect(storedRows(harness, thread.id).map((row) => row.type)).toEqual([
        "turn/started",
        "provider/unhandled",
      ]);
    } finally {
      await harness.cleanup();
    }
  });
});
