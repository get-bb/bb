/**
 * Namespaced presentation glyphs (`"<pluginId>/<name>"`) are validated at
 * ingest against the icons the thread's provider plugin declares. A glyph
 * naming the plugin's own declared icon persists as-is; one naming another
 * plugin or an undeclared name persists as a visible `provider/unhandled` in
 * the same batch slot, with the glyph in the reason. Host glyphs are never
 * touched here. A `server: "bb"` tool row is the exception: its presentation
 * came from the plugin that registered the tool, so its glyph is checked
 * against that plugin, not the thread's provider plugin.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { events } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
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

async function setup() {
  const harness = await createTestAppHarness();
  harness.deps.providerRegistry.register({
    ...buildPluginProviderRegistration({
      available: true,
      pluginId: PLUGIN_ID,
      declaration: validatePluginProviderDeclaration({
        id: PROVIDER_ID,
        displayName: "Widgets",
        maintenance: { health: false, usage: false, installation: false },
        capabilities: {
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
      }),
      readSettings: () => ({}),
    }),
    pluginId: PLUGIN_ID,
    // What `bb.branding.experimental_icons` declared for this plugin.
    iconNames: new Set(["gauge"]),
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

function toolItem(
  threadId: string,
  id: string,
  glyph: string,
  type: "item/started" | "item/completed" = "item/completed",
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type,
      threadId,
      providerThreadId: "prov-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id,
        tool: "gauge",
        server: "widgets",
        status: type === "item/completed" ? "completed" : "pending",
        presentation: {
          label: { pending: "Reading gauge", completed: "Read gauge" },
          icon: { glyph },
        },
        parentToolCallId: "parent-1",
      },
    },
  };
}

describe("presentation icon ingest validation", () => {
  it("persists the plugin's own declared icon and any host glyph untouched", async () => {
    const { harness, session, thread } = await setup();
    try {
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        toolItem(thread.id, "item-1", `${PLUGIN_ID}/gauge`, "item/started"),
        toolItem(thread.id, "item-1", `${PLUGIN_ID}/gauge`),
        toolItem(thread.id, "item-2", "Terminal"),
        // A host glyph the client may not know is still the client's call.
        toolItem(thread.id, "item-3", "NotAGlyphAnyoneKnows"),
      ]);
      expect(response.status).toBe(200);
      expect(
        storedRows(harness, thread.id).map((row) => [
          row.type,
          (row.data as { item?: { presentation?: { icon: { glyph: string } } } })
            .item?.presentation?.icon.glyph,
        ]),
      ).toEqual([
        ["turn/started", undefined],
        ["item/started", `${PLUGIN_ID}/gauge`],
        ["item/completed", `${PLUGIN_ID}/gauge`],
        ["item/completed", "Terminal"],
        ["item/completed", "NotAGlyphAnyoneKnows"],
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("replaces an undeclared or foreign namespaced glyph with provider/unhandled naming the glyph", async () => {
    const { harness, session, thread } = await setup();
    try {
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        toolItem(thread.id, "item-1", `${PLUGIN_ID}/dial`),
        toolItem(thread.id, "item-2", "other-plugin/gauge"),
        toolItem(thread.id, "item-3", `${PLUGIN_ID}/gauge`),
      ]);
      expect(response.status).toBe(200);
      // Every slot was accepted: the replacement keeps the batch shape.
      await expect(readJson(response)).resolves.toMatchObject({
        acceptedEvents: [
          { eventIndex: 0 },
          { eventIndex: 1 },
          { eventIndex: 2 },
          { eventIndex: 3 },
        ],
        rejectedEvents: [],
      });
      const rows = storedRows(harness, thread.id);
      expect(rows.map((row) => row.type)).toEqual([
        "turn/started",
        "provider/unhandled",
        "provider/unhandled",
        "item/completed",
      ]);
      expect(rows[1]).toMatchObject({
        itemKind: null,
        scopeKind: "turn",
        turnId: "turn-1",
        data: {
          providerId: PROVIDER_ID,
          rawType: "presentation/icon:toolCall",
          rawEvent: {
            method: "item/completed",
            params: {
              itemId: "item-1",
              itemType: "toolCall",
              glyph: `${PLUGIN_ID}/dial`,
              reason: `presentation.icon "${PLUGIN_ID}/dial" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
          parentToolCallId: "parent-1",
        },
      });
      expect(rows[2]).toMatchObject({
        data: {
          rawEvent: {
            params: {
              glyph: "other-plugin/gauge",
              reason: `presentation.icon "other-plugin/gauge" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
        },
      });
    } finally {
      await harness.cleanup();
    }
  });
});

/**
 * The thread-scoped snapshots of a background delegation or task carry the
 * full item, presentation included, and the assembler stamps the close's
 * presentation on the terminal one — so they are where a background item's
 * final glyph actually persists. They are held to the same rule as the
 * turn-scoped open/close pair.
 */
function presentationOf(glyph: string) {
  return {
    label: { pending: "Working", completed: "Worked" },
    icon: { glyph },
  };
}

function delegationSnapshot(
  threadId: string,
  type: "item/delegation/progress" | "item/delegation/completed",
  id: string,
  glyph: string,
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type,
      threadId,
      providerThreadId: "prov-1",
      scope: threadScope(),
      item: {
        type: "delegation",
        id,
        childRef: "child-1",
        label: "child",
        status: type === "item/delegation/completed" ? "completed" : "pending",
        background: true,
        presentation: presentationOf(glyph),
        parentToolCallId: "parent-1",
      },
    },
  };
}

function backgroundTaskSnapshot(
  threadId: string,
  type: "item/backgroundTask/progress" | "item/backgroundTask/completed",
  id: string,
  glyph: string,
): HostDaemonEventEnvelope {
  const completed = type === "item/backgroundTask/completed";
  return {
    threadId,
    event: {
      type,
      threadId,
      providerThreadId: "prov-1",
      scope: threadScope(),
      item: {
        type: "backgroundTask",
        id,
        familyId: "fam-1",
        taskType: "local_bash",
        description: "bg",
        status: completed ? "completed" : "pending",
        taskStatus: completed ? "completed" : "running",
        skipTranscript: false,
        presentation: presentationOf(glyph),
      },
    },
  };
}

type ItemSnapshotEventType =
  | "item/delegation/progress"
  | "item/delegation/completed"
  | "item/backgroundTask/progress"
  | "item/backgroundTask/completed";

function itemSnapshot(
  threadId: string,
  type: ItemSnapshotEventType,
  id: string,
  glyph: string,
): HostDaemonEventEnvelope {
  return type === "item/delegation/progress" ||
    type === "item/delegation/completed"
    ? delegationSnapshot(threadId, type, id, glyph)
    : backgroundTaskSnapshot(threadId, type, id, glyph);
}

describe("presentation icon ingest validation on thread-scoped item snapshots", () => {
  it.each<ItemSnapshotEventType>([
    "item/delegation/progress",
    "item/delegation/completed",
    "item/backgroundTask/progress",
    "item/backgroundTask/completed",
  ])("holds %s to the provider plugin's declared icons", async (type) => {
    const { harness, session, thread } = await setup();
    try {
      // One item per snapshot: a second terminal snapshot of the same
      // item would be dropped as a duplicate settlement, not for its glyph.
      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        itemSnapshot(thread.id, type, "item-1", `${PLUGIN_ID}/gauge`),
        itemSnapshot(thread.id, type, "item-2", "Terminal"),
        itemSnapshot(thread.id, type, "item-3", "other-plugin/gauge"),
        itemSnapshot(thread.id, type, "item-4", `${PLUGIN_ID}/dial`),
      ]);
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        acceptedEvents: [
          { eventIndex: 0 },
          { eventIndex: 1 },
          { eventIndex: 2 },
          { eventIndex: 3 },
          { eventIndex: 4 },
        ],
        rejectedEvents: [],
      });
      const rows = storedRows(harness, thread.id);
      expect(rows.map((row) => [row.type, storedGlyph(row)])).toEqual([
        ["turn/started", undefined],
        [type, `${PLUGIN_ID}/gauge`],
        [type, "Terminal"],
        ["provider/unhandled", undefined],
        ["provider/unhandled", undefined],
      ]);
      const itemType = type.startsWith("item/delegation/")
        ? "delegation"
        : "backgroundTask";
      // The replacement sits where the snapshot would have: thread scope,
      // the item's identity and parent, the glyph and the reason.
      expect(rows[3]).toMatchObject({
        itemKind: null,
        scopeKind: "thread",
        turnId: null,
        data: {
          providerId: PROVIDER_ID,
          rawType: `presentation/icon:${itemType}`,
          rawEvent: {
            method: type,
            params: {
              itemId: "item-3",
              itemType,
              glyph: "other-plugin/gauge",
              reason: `presentation.icon "other-plugin/gauge" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
          ...(itemType === "delegation"
            ? { parentToolCallId: "parent-1" }
            : {}),
        },
      });
      expect(rows[4]).toMatchObject({
        data: {
          rawEvent: {
            params: {
              itemId: "item-4",
              glyph: `${PLUGIN_ID}/dial`,
              reason: `presentation.icon "${PLUGIN_ID}/dial" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
        },
      });
    } finally {
      await harness.cleanup();
    }
  });
});

/**
 * A plugin (`tooled`) that declares one icon and registers one bb tool whose
 * presentation names it. It is not a provider plugin: the thread it is
 * exercised on belongs to `widgets`.
 */
const TOOL_PLUGIN_ID = "tooled";
const TOOL_ICON_GLYPH = `${TOOL_PLUGIN_ID}/stamp`;
const STAMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v16H4z"/></svg>`;

async function writeToolPluginFixture(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, "icons"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${TOOL_PLUGIN_ID}`,
      version: "0.1.0",
      bb: {
        name: "Tooled",
        description: "Registers a tool with a declared icon.",
        branding: {
          icon: "Zap",
          experimental_icons: { stamp: "./icons/stamp.svg" },
        },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    "export default function plugin() {}\n",
  );
  await writeFile(join(rootDir, "icons", "stamp.svg"), STAMP_SVG);
}

/** A call to a bb-injected tool, as the provider bridge stamps it. */
function bbToolItem(
  threadId: string,
  id: string,
  tool: string,
  glyph: string,
): HostDaemonEventEnvelope {
  return {
    threadId,
    event: {
      type: "item/completed",
      threadId,
      providerThreadId: "prov-1",
      scope: turnScope("turn-1"),
      item: {
        type: "toolCall",
        id,
        tool,
        server: "bb",
        status: "completed",
        presentation: {
          label: { pending: "Stamping", completed: "Stamped" },
          icon: { glyph },
        },
      },
    },
  };
}

function storedGlyph(row: { data: unknown }): string | undefined {
  return (row.data as { item?: { presentation?: { icon: { glyph: string } } } })
    .item?.presentation?.icon.glyph;
}

describe("presentation icon ingest validation for bb-injected tool rows", () => {
  it("keeps the tool plugin's declared icon on a thread of another provider plugin, and refuses any other glyph on a bb tool row", async () => {
    const { harness, session, thread } = await setup();
    try {
      const rootDir = join(
        harness.config.dataDir,
        "fixtures",
        `bb-plugin-${TOOL_PLUGIN_ID}`,
      );
      await writeToolPluginFixture(rootDir);
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status, entry.statusDetail ?? "").toBe("running");
      // registerTool verified the glyph against the `tooled` manifest; the
      // server resolves this presentation for the bridge to stamp on the row.
      harness.pluginService.getApi(TOOL_PLUGIN_ID)!.agents.registerTool({
        name: "stamp_tool",
        description: "Names a declared icon",
        presentation: { icon: { glyph: TOOL_ICON_GLYPH } },
        parameters: { type: "object" },
        execute: () => "ok",
      });

      const response = await post(harness, session.id, [
        turnStarted(thread.id),
        // The feature: the tool's own icon survives ingest on a thread whose
        // provider plugin (`provider-widgets`) never declared it.
        bbToolItem(thread.id, "item-1", "stamp_tool", TOOL_ICON_GLYPH),
        // The glyph names a plugin other than the one that registered the tool.
        bbToolItem(thread.id, "item-2", "stamp_tool", "other-plugin/stamp"),
        // No plugin registers a tool by this name.
        bbToolItem(thread.id, "item-3", "no_such_tool", TOOL_ICON_GLYPH),
        // A provider-authored row (no `server: "bb"`) borrowing the tool
        // plugin's icon is still held to the provider plugin's declarations.
        toolItem(thread.id, "item-4", TOOL_ICON_GLYPH),
      ]);
      expect(response.status).toBe(200);
      const rows = storedRows(harness, thread.id);
      expect(rows.map((row) => [row.type, storedGlyph(row)])).toEqual([
        ["turn/started", undefined],
        ["item/completed", TOOL_ICON_GLYPH],
        ["provider/unhandled", undefined],
        ["provider/unhandled", undefined],
        ["provider/unhandled", undefined],
      ]);
      expect(rows[2]).toMatchObject({
        data: {
          providerId: PROVIDER_ID,
          rawEvent: {
            params: {
              itemId: "item-2",
              glyph: "other-plugin/stamp",
              reason: `presentation.icon "other-plugin/stamp" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
        },
      });
      expect(rows[4]).toMatchObject({
        data: {
          rawEvent: {
            params: {
              itemId: "item-4",
              reason: `presentation.icon "${TOOL_ICON_GLYPH}" is not an icon declared by plugin "${PLUGIN_ID}"`,
            },
          },
        },
      });
    } finally {
      await harness.pluginService.stop();
      await harness.cleanup();
    }
  });
});
