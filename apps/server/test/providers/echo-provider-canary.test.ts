/**
 * The third-party canary, end to end on the server side.
 *
 * `examples/plugins/echo-provider` is a provider plugin that uses ONLY the
 * public SDK. This test installs it the way a user would (from its checkout
 * path), lets the server build the real thread command for it (plugin
 * settings → `deriveProviderOptions` → `providerOptions`; the plugin's bb
 * tool → `dynamicTools` with its resolved presentation; the built host
 * artifact → `bridgeLaunch`), runs that command on the REAL agent runtime
 * (bridge bootstrap → the artifact → bridge-protocol adapter → delta
 * assembler), feeds every runtime event through the REAL ingest route the
 * daemon uses, answers the bridge's tool call through the REAL tool-call
 * route, and then reads the rows back out of the database.
 *
 * What it proves, row by row: presentation persisted on every item; the
 * extension item validated against the plugin's declared schema (and a
 * malformed payload replaced by `provider/unhandled`); the extension state
 * row; the delegation's child turn linked by `parentToolCallId`; the
 * planSteps snapshot; the bb tool stamped `server: "bb"` with the
 * definition's presentation and the result the plugin's own `execute`
 * produced; and the settings/env round trip echoed into the message.
 *
 * Core test code, so `@bb/*` imports are fine here; the plugin under test has
 * none (its own suite guards that).
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeSkillRoot,
} from "@bb/agent-runtime";
import { events } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  toolCallResponseSchema,
  type ThreadEvent,
  type ToolCallRequest,
  type ToolCallResponse,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import {
  copyBuiltinSkills,
  resolveBuiltinSkillsRootPath,
} from "../../src/services/skills/builtin-skills-copy.js";
import { buildThreadStartCommand } from "../../src/services/threads/thread-commands.js";
import { resolveExecutionOptions } from "../../src/services/threads/thread-runtime-config.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

const ECHO_PLUGIN_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../examples/plugins/echo-provider",
);
const PLUGIN_ID = "echo-provider";
const PROVIDER_ID = "echo-agent";
const RECEIPT_KIND = `${PLUGIN_ID}/receipt`;
const MOOD_KIND = `${PLUGIN_ID}/mood`;
/** The plugin's one declared icon (`bb.branding.experimental_icons`). */
const RECEIPT_ICON_GLYPH = `${PLUGIN_ID}/receipt`;
const GREETING_ENV = "BB_ECHO_PROVIDER_GREETING";
const STAMP_PRESENTATION = {
  label: { pending: "Stamping receipt", completed: "Stamped receipt" },
  icon: { glyph: "Check" },
  tint: { light: "#1d4ed8", dark: "#93c5fd" },
};

interface StoredRow {
  type: string;
  itemKind: string | null;
  turnId: string | null;
  data: Record<string, unknown> & {
    item?: Record<string, unknown>;
    parentToolCallId?: string;
  };
}

function storedRows(harness: TestAppHarness, threadId: string): StoredRow[] {
  return harness.db
    .select({
      type: events.type,
      itemKind: events.itemKind,
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
      turnId: row.turnId,
      data: JSON.parse(row.data) as StoredRow["data"],
    }));
}

function completedItems(rows: StoredRow[]): StoredRow[] {
  return rows.filter((row) => row.type === "item/completed");
}

function itemOf(rows: StoredRow[], itemKind: string, tool?: string): StoredRow {
  const row = completedItems(rows).find(
    (candidate) =>
      candidate.itemKind === itemKind &&
      (tool === undefined || candidate.data.item?.tool === tool),
  );
  expect(
    row,
    `a completed ${itemKind}${tool ? ` ${tool}` : ""} row`,
  ).toBeDefined();
  return row as StoredRow;
}

function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const tick = () => {
      if (predicate()) {
        resolvePromise();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        rejectPromise(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

const RUNTIME_TO_BRIDGE_LANE = "runtime→bridge.ndjson";
const recordingEntrySchema = z.object({ seq: z.number(), line: z.string() });
const recordedRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
});

/**
 * Every request the bridge received on the runtime wire, in wire order.
 * Bridge record mode (docs/provider-bridge-protocol.md) tees that wire into
 * `<dir>/<providerId>/<scope>/runtime→bridge.ndjson`, one scope per thread
 * plus `_process` for the handshake; `seq` orders entries across scopes.
 * Responses (no method) and notifications (no id) are left out.
 */
async function bridgeRequestMethods(recordDir: string): Promise<string[]> {
  const providerDir = join(recordDir, PROVIDER_ID);
  const requests: { seq: number; method: string }[] = [];
  for (const scope of await readdir(providerDir)) {
    const scopeDir = join(providerDir, scope);
    if (!(await readdir(scopeDir)).includes(RUNTIME_TO_BRIDGE_LANE)) continue;
    const raw = await readFile(join(scopeDir, RUNTIME_TO_BRIDGE_LANE), "utf8");
    for (const line of raw.split("\n").filter((entry) => entry.length > 0)) {
      const entry = recordingEntrySchema.parse(JSON.parse(line));
      const request = recordedRequestSchema.safeParse(JSON.parse(entry.line));
      if (request.success) {
        requests.push({ seq: entry.seq, method: request.data.method });
      }
    }
  }
  return requests
    .sort((left, right) => left.seq - right.seq)
    .map((request) => request.method);
}

describe("echo-provider canary: plugin install → server command → runtime → ingest", () => {
  let harness: TestAppHarness;
  let runtime: AgentRuntime | null = null;
  let workspaceDir: string;
  let bridgeDataDir: string;
  let recordDir: string;
  let savedGreeting: string | undefined;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    workspaceDir = await mkdtemp(join(tmpdir(), "bb-echo-canary-ws-"));
    bridgeDataDir = await mkdtemp(join(tmpdir(), "bb-echo-canary-bridge-"));
    recordDir = await mkdtemp(join(tmpdir(), "bb-echo-canary-record-"));
    savedGreeting = process.env[GREETING_ENV];
    // The declaration names this variable in `env.passthrough`;
    // the runtime forwards exactly the declared names past its `BB_*` strip.
    process.env[GREETING_ENV] = "hello from the daemon";
  });

  afterEach(async () => {
    await runtime?.shutdown();
    runtime = null;
    if (savedGreeting === undefined) {
      delete process.env[GREETING_ENV];
    } else {
      process.env[GREETING_ENV] = savedGreeting;
    }
    await harness.cleanup();
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(bridgeDataDir, { recursive: true, force: true });
    await rm(recordDir, { recursive: true, force: true });
  });

  it("persists every grammar v3 capability the third-party bridge emits", async () => {
    // 1. Install the example plugin from its checkout path: the server runs
    //    server.ts (registration, settings, the bb tool) and builds host.ts
    //    into the artifact the daemon would download.
    const entry = await harness.pluginService.installPath(ECHO_PLUGIN_ROOT);
    expect(entry.status, entry.statusDetail ?? "").toBe("running");
    expect(entry.id).toBe(PLUGIN_ID);
    const artifact = harness.deps.pluginHostArtifacts.get(PLUGIN_ID);
    expect(artifact, "the plugin's bb.host artifact was built").toBeDefined();
    if (artifact === undefined) throw new Error("unreachable");

    // The plugin's own setting, flipped through the server's settings API.
    await harness.pluginService.updateSettings(PLUGIN_ID, { shout: true });

    const registration = harness.deps.providerRegistry.get(PROVIDER_ID);
    expect(registration?.info).toMatchObject({
      id: PROVIDER_ID,
      displayName: "Echo",
      capabilities: { supportsServiceTier: true },
    });
    expect(
      harness.deps.providerRegistry.getExtensionKindSchemas(RECEIPT_KIND)?.item,
    ).toBeDefined();
    expect(
      harness.deps.providerRegistry.getExtensionKindSchemas(MOOD_KIND)?.state,
    ).toBeDefined();

    // 2. A thread on the echo provider, and the REAL thread.start command.
    const { host, session } = seedHostSession(harness.deps, {
      id: "host-echo-canary",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: workspaceDir,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: PROVIDER_ID,
      status: "active",
    });
    const execution = await resolveExecutionOptions(harness.deps, {
      threadId: thread.id,
      requestedExecution: { model: "echo-1", source: "client/turn/requested" },
    });
    const command = await buildThreadStartCommand(harness.deps, {
      environment,
      execution,
      fork: null,
      permissionEscalation: "ask",
      input: textInput("hello canary"),
      projectId: project.id,
      providerId: PROVIDER_ID,
      requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      syncGeneratedTitle: false,
      thread,
    });

    // What the server derived for the bridge: the plugin's setting inside
    // providerOptions, the declared env passthrough, the bb tool with the
    // presentation resolved from its registration, the artifact launch.
    expect(command.options.providerOptions).toEqual({
      shout: true,
      model: "echo-1",
      promptMode: null,
    });
    expect(command.bridgeLaunch).toMatchObject({
      pluginId: PLUGIN_ID,
      source: { kind: "artifact", digest: artifact.digest },
      envPassthrough: [GREETING_ENV],
      capabilities: { supportsServiceTier: true, fork: "none" },
    });
    const stampTool = command.dynamicTools.find(
      (tool) => tool.name === "echo_stamp",
    );
    expect(stampTool).toMatchObject({ presentation: STAMP_PRESENTATION });
    if (command.bridgeLaunch.source.kind !== "artifact") {
      throw new Error("expected an artifact launch");
    }

    // 3. The REAL runtime, launching the built artifact exactly as the
    //    daemon does, with every event and tool call routed to the REAL
    //    server routes the daemon uses.
    const runtimeEvents: ThreadEvent[] = [];
    let ingest: Promise<void> = Promise.resolve();
    const ingestEvent = (event: ThreadEvent): void => {
      ingest = ingest.then(async () => {
        const response = await harness.app.request("/internal/session/events", {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              { threadId: event.threadId, event },
            ]),
          }),
        });
        expect(response.status, `ingest ${event.type}`).toBe(200);
      });
    };
    const toolCalls: ToolCallRequest[] = [];
    const runtimeInstance = createAgentRuntime({
      workspacePath: workspaceDir,
      onEvent: (event) => {
        runtimeEvents.push(event);
        ingestEvent(event);
      },
      onToolCall: async (request): Promise<ToolCallResponse> => {
        toolCalls.push(request);
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: request.threadId,
              providerThreadId: request.providerThreadId,
              turnId: request.turnId,
              callId: request.callId,
              tool: request.tool,
              arguments: request.arguments,
            }),
          },
        );
        expect(response.status).toBe(200);
        return toolCallResponseSchema.parse(await response.json());
      },
    });
    runtime = runtimeInstance;
    const bridgeLaunch = {
      pluginId: command.bridgeLaunch.pluginId,
      dataDir: bridgeDataDir,
      source: {
        kind: "artifact" as const,
        digest: command.bridgeLaunch.source.digest,
        artifactPath: artifact.path,
      },
      capabilities: command.bridgeLaunch.capabilities,
      providerOptions: command.bridgeLaunch.providerOptions,
      envPassthrough: command.bridgeLaunch.envPassthrough,
    };
    await runtimeInstance.startThread({
      bridgeLaunch,
      environmentId: environment.id,
      threadId: thread.id,
      projectId: project.id,
      providerId: PROVIDER_ID,
      clientRequestId: command.requestId,
      input: command.input,
      options: command.options,
      instructions: command.instructions,
      dynamicTools: command.dynamicTools,
      instructionMode: command.instructionMode,
    });
    const turnCompletedCount = () =>
      runtimeEvents.filter((event) => event.type === "turn/completed").length;
    // The main turn and the delegation's child turn.
    await waitFor(() => turnCompletedCount() >= 2, "the first echo turn");
    await ingest;

    // The bb tool ran through the server: the plugin's own execute answered.
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      threadId: thread.id,
      tool: "echo_stamp",
      arguments: { text: "hello canary" },
    });

    // 4. The rows.
    const rows = storedRows(harness, thread.id);
    const completed = completedItems(rows);
    expect(completed.map((row) => row.itemKind)).toEqual([
      "commandExecution",
      "fileRead",
      "search",
      "agentMessage",
      "delegation",
      "planSteps",
      "toolCall",
      "toolCall",
      "extension",
      "agentMessage",
    ]);
    // Presentation persisted on EVERY item row, opened and completed.
    const itemRows = rows.filter(
      (row) => row.type === "item/started" || row.type === "item/completed",
    );
    expect(itemRows.length).toBeGreaterThanOrEqual(20);
    for (const row of itemRows) {
      expect(
        row.data.item?.presentation,
        `${row.type} ${row.itemKind} carries presentation`,
      ).toMatchObject({
        label: { pending: expect.any(String), completed: expect.any(String) },
        icon: { glyph: expect.any(String) },
      });
    }

    // The extension item, validated against the declared schema. Its icon
    // is the plugin's own declared icon by its namespaced glyph, accepted
    // at ingest because the registration carries the manifest's icon names
    // and advertised on the inventory as a hashed, servable SVG.
    expect(itemOf(rows, "extension").data.item).toMatchObject({
      kind: RECEIPT_KIND,
      payload: { prompt: "hello canary", itemCount: 7, shouted: true },
      presentation: {
        label: { completed: "Wrote receipt" },
        icon: { glyph: RECEIPT_ICON_GLYPH },
        detail: "Echoed 7 items, shouting.",
      },
    });
    expect(registration?.iconNames).toEqual(new Set(["receipt"]));
    expect(entry.icons.receipt).toMatch(
      /^\/api\/v1\/plugins\/echo-provider\/assets\/icons\/receipt\.svg\?h=[0-9a-f]{16}$/,
    );
    const receiptIcon = await harness.app.request(
      `http://127.0.0.1:3334${entry.icons.receipt}`,
    );
    expect(receiptIcon.status).toBe(200);
    expect(receiptIcon.headers.get("content-type")).toBe("image/svg+xml");
    // The extension state row.
    expect(
      rows.find((row) => row.type === "thread/extensionState/updated")?.data,
    ).toMatchObject({
      kind: MOOD_KIND,
      payload: { mood: "cheerful", turnsEchoed: 1 },
    });

    // The delegation and its child turn, linked by parentToolCallId.
    const delegation = itemOf(rows, "delegation");
    expect(delegation.data.item).toMatchObject({
      background: false,
      status: "completed",
      summary: "child echo: hello canary",
      presentation: { icon: { glyph: "UserRound" } },
    });
    const childTurn = rows.find(
      (row) =>
        row.type === "turn/started" && row.data.parentToolCallId !== undefined,
    );
    expect(childTurn?.data.parentToolCallId).toBe(delegation.data.item?.id);
    const childMessage = completed.find(
      (row) =>
        row.itemKind === "agentMessage" &&
        row.data.item?.parentToolCallId !== undefined,
    );
    expect(childMessage?.data.item).toMatchObject({
      text: "child echo: hello canary",
      parentToolCallId: delegation.data.item?.id,
    });
    expect(childMessage?.turnId).toBe(childTurn?.turnId);
    expect(childTurn?.turnId).not.toBe(delegation.turnId);

    // planSteps.
    expect(itemOf(rows, "planSteps").data.item).toMatchObject({
      steps: [
        { step: "Hear the prompt", status: "completed" },
        { step: 'Echo "hello canary"', status: "completed" },
        { step: "Write the receipt", status: "completed" },
      ],
      presentation: { icon: { glyph: "ListTodo" } },
    });

    // The core v3 kinds.
    expect(itemOf(rows, "fileRead").data.item).toMatchObject({
      path: `${workspaceDir}/README.md`,
      presentation: { icon: { glyph: "FileText" } },
    });
    expect(itemOf(rows, "search").data.item).toMatchObject({
      mode: "content",
      query: "hello canary",
      presentation: { icon: { glyph: "Search" } },
    });
    expect(itemOf(rows, "commandExecution").data.item).toMatchObject({
      command: 'echo "hello canary"',
      exitCode: 0,
      aggregatedOutput: "hello canary\n",
      presentation: { icon: { glyph: "Terminal" } },
    });

    // Tools: the suppressed row and the bb tool with the definition's
    // presentation, stamped server:"bb", carrying the plugin's real result.
    expect(itemOf(rows, "toolCall", "echo_noop").data.item).toMatchObject({
      presentation: { suppress: true },
    });
    expect(itemOf(rows, "toolCall", "echo_stamp").data.item).toMatchObject({
      server: "bb",
      status: "completed",
      result: "stamped: hello canary",
      presentation: STAMP_PRESENTATION,
    });

    // The echoed message: the setting and the env var made the round trip.
    const message = completed
      .filter(
        (row) =>
          row.itemKind === "agentMessage" &&
          row.data.item?.parentToolCallId === undefined,
      )
      .at(-1);
    expect(message?.data.item?.text).toBe(
      [
        "echo: HELLO CANARY",
        "providerOptions (server): shout=true model=echo-1 promptMode=none",
        `${GREETING_ENV}=hello from the daemon`,
        "echo_stamp: stamped: hello canary",
      ].join("\n"),
    );

    // 5. A malformed extension payload is rejected at ingest: the item rows
    //    persist as provider/unhandled, nothing else in the batch is lost.
    const before = rows.length;
    await runtimeInstance.runTurn({
      threadId: thread.id,
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 2 }),
      input: textInput("malformed-receipt now"),
      options: command.options,
    });
    await waitFor(() => turnCompletedCount() >= 4, "the second echo turn");
    await ingest;
    const secondTurnRows = storedRows(harness, thread.id).slice(before);
    expect(
      secondTurnRows.filter((row) => row.itemKind === "extension"),
    ).toEqual([]);
    const unhandled = secondTurnRows.filter(
      (row) => row.type === "provider/unhandled",
    );
    expect(unhandled).toHaveLength(2);
    expect(unhandled[0]?.data).toMatchObject({
      providerId: PROVIDER_ID,
      rawType: `extension/item:${RECEIPT_KIND}`,
      rawEvent: {
        params: {
          kind: RECEIPT_KIND,
          payload: { prompt: 42, itemCount: "many" },
          reason: expect.stringContaining("prompt"),
        },
      },
    });
    // The well-formed state row of the same turn still persisted.
    expect(
      secondTurnRows.find((row) => row.type === "thread/extensionState/updated")
        ?.data,
    ).toMatchObject({ kind: MOOD_KIND, payload: { turnsEchoed: 2 } });

    // 6. A namespaced presentation glyph the plugin did not declare is
    //    rejected at ingest through the same route the daemon uses: the item
    //    persists as provider/unhandled with the glyph in the reason, while
    //    the plugin's own declared icon (the receipt above) went through.
    const rejectedBefore = storedRows(harness, thread.id).length;
    const secondTurn = secondTurnRows.find(
      (row) => row.type === "turn/started" && row.turnId !== null,
    );
    const providerThreadId = secondTurn?.data.providerThreadId;
    if (secondTurn?.turnId == null || typeof providerThreadId !== "string") {
      throw new Error("expected the second turn's turn/started row");
    }
    const undeclared = await harness.app.request("/internal/session/events", {
      method: "POST",
      headers: internalAuthHeaders(harness),
      body: JSON.stringify({
        sessionId: session.id,
        eventGroups: groupHostDaemonEvents([
          {
            threadId: thread.id,
            event: {
              type: "item/completed",
              threadId: thread.id,
              providerThreadId,
              scope: { kind: "turn", turnId: secondTurn.turnId },
              item: {
                type: "toolCall",
                id: "item-undeclared",
                tool: "echo_noop",
                server: PROVIDER_ID,
                status: "completed",
                presentation: {
                  label: { pending: "Sealing", completed: "Sealed" },
                  icon: { glyph: `${PLUGIN_ID}/seal` },
                },
              },
            },
          },
        ]),
      }),
    });
    expect(undeclared.status).toBe(200);
    const rejected = storedRows(harness, thread.id).slice(rejectedBefore);
    expect(rejected.map((row) => row.type)).toEqual(["provider/unhandled"]);
    expect(rejected[0]?.data).toMatchObject({
      providerId: PROVIDER_ID,
      rawType: "presentation/icon:toolCall",
      rawEvent: {
        params: {
          itemId: "item-undeclared",
          glyph: `${PLUGIN_ID}/seal`,
          reason: `presentation.icon "${PLUGIN_ID}/seal" is not an icon declared by plugin "${PLUGIN_ID}"`,
        },
      },
    });
  }, 120_000);

  it("runs a turn with the built-in skills tier staged and sends the bridge only the requests it handles", async () => {
    // The production catalog shape: the built-in tier is always present
    // (resolveSkillCatalog), and here it holds the REAL bundled skills the
    // server ships, copied the way the build stages them beside the module.
    await copyBuiltinSkills({
      skillsRootPath: resolveBuiltinSkillsRootPath(),
      targetPath: harness.config.builtinSkillsRootPath,
    });
    const entry = await harness.pluginService.installPath(ECHO_PLUGIN_ROOT);
    expect(entry.status, entry.statusDetail ?? "").toBe("running");
    const artifact = harness.deps.pluginHostArtifacts.get(PLUGIN_ID);
    if (artifact === undefined) {
      throw new Error("the plugin's bb.host artifact was not built");
    }

    const { host, session } = seedHostSession(harness.deps, {
      id: "host-echo-canary-skills",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
      path: workspaceDir,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: PROVIDER_ID,
      status: "active",
    });
    const execution = await resolveExecutionOptions(harness.deps, {
      threadId: thread.id,
      requestedExecution: { model: "echo-1", source: "client/turn/requested" },
    });
    const command = await buildThreadStartCommand(harness.deps, {
      environment,
      execution,
      fork: null,
      permissionEscalation: "ask",
      input: textInput("hello skills"),
      projectId: project.id,
      providerId: PROVIDER_ID,
      requestId: encodeClientTurnRequestIdNumber({ value: 1 }),
      syncGeneratedTitle: false,
      thread,
    });
    if (command.bridgeLaunch.source.kind !== "artifact") {
      throw new Error("expected an artifact launch");
    }
    // The built-in tier rode the thread.start command to the daemon.
    expect(
      command.injectedSkillSources
        .filter((source) => source.sourceType === "builtin")
        .map((source) => source.name),
    ).toContain("bb-cli");

    // What the daemon stages from that catalog and hands the runtime: one
    // generic root over the staged directory, with the skills it lists
    // (apps/host-daemon/src/injected-skills.ts, buildSkillRoots); each bridge
    // maps that root to its own layout. The daemon is not importable from a
    // server test, so the canary hands the runtime the same root over the
    // tier's own directory.
    const skillDirectoryRootPath = harness.config.builtinSkillsRootPath;
    const skillRoots: AgentRuntimeSkillRoot[] = [
      {
        id: "global-skills:canary",
        path: skillDirectoryRootPath,
        skills: command.injectedSkillSources.map((source) => ({
          name: source.name,
          description: source.description,
        })),
      },
    ];

    const runtimeEvents: ThreadEvent[] = [];
    const toolCalls: ToolCallRequest[] = [];
    const runtimeInstance = createAgentRuntime({
      workspacePath: workspaceDir,
      // Bridge record mode, forwarded the way the daemon forwards it
      // (docs/provider-bridge-protocol.md): the bootstrap tees every line
      // the bridge receives into the recording the last assertion reads.
      env: { BB_PROVIDER_BRIDGE_RECORD_DIR: recordDir },
      skillRoots,
      onEvent: (event) => {
        runtimeEvents.push(event);
      },
      onToolCall: async (request): Promise<ToolCallResponse> => {
        toolCalls.push(request);
        const response = await harness.app.request(
          "/internal/session/tool-call",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              threadId: request.threadId,
              providerThreadId: request.providerThreadId,
              turnId: request.turnId,
              callId: request.callId,
              tool: request.tool,
              arguments: request.arguments,
            }),
          },
        );
        expect(response.status).toBe(200);
        return toolCallResponseSchema.parse(await response.json());
      },
    });
    runtime = runtimeInstance;
    await runtimeInstance.startThread({
      bridgeLaunch: {
        pluginId: command.bridgeLaunch.pluginId,
        dataDir: bridgeDataDir,
        source: {
          kind: "artifact",
          digest: command.bridgeLaunch.source.digest,
          artifactPath: artifact.path,
        },
        capabilities: command.bridgeLaunch.capabilities,
        providerOptions: command.bridgeLaunch.providerOptions,
        envPassthrough: command.bridgeLaunch.envPassthrough,
      },
      environmentId: environment.id,
      threadId: thread.id,
      projectId: project.id,
      providerId: PROVIDER_ID,
      clientRequestId: command.requestId,
      input: command.input,
      options: command.options,
      instructions: command.instructions,
      dynamicTools: command.dynamicTools,
      instructionMode: command.instructionMode,
    });
    // The main turn and the delegation's child turn both completed, and the
    // bb tool ran through the server on the way.
    await waitFor(
      () =>
        runtimeEvents.filter((event) => event.type === "turn/completed")
          .length >= 2,
      "the echo turn with the built-in tier staged",
    );
    expect(toolCalls.map((call) => call.tool)).toEqual(["echo_stamp"]);

    // What the bridge received on the runtime wire: the handshake, the
    // thread start, the first turn, and no `skills/configure`. The runtime
    // gates that request per bridge; this one never advertised it and answers
    // any method it does not handle with -32601, so a mis-gated runtime fails
    // the startup above as well as this list.
    expect(await bridgeRequestMethods(recordDir)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
    ]);
  }, 120_000);
});
