import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { listQueuedThreadMessages } from "@bb/db";
import type {
  PendingInteractionCreate,
  Thread,
  ThreadParentNotifications,
} from "@bb/domain";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  createCommandApprovalPayload,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const NOTICE_SETTLE_MS = 100;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const INSERT_CALL = /(?<!function\s)\bcreatePendingInteraction\(/gu;

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

interface Fixture {
  child: Thread;
  harness: TestAppHarness;
  sessionId: string;
}

interface CreationPath {
  name: string;
  create: (fixture: Fixture) => Promise<() => Promise<void>>;
}

afterEach(() => {
  setPluginHookProvider(undefined);
  setPluginThreadEventEmitter(undefined);
});

function holdParentDeliveries(): void {
  const registry: HookRegistry = {
    "thread.delete_finalize": [],
    "message.dispatch": [
      {
        pluginId: "hold-parent",
        handler: () => ({ action: "wait", reason: "Counting notices" }),
      },
    ],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
    isLoadingPlugins: () => false,
  });
}

function recordPendingAnnouncements(): string[] {
  const announced: string[] = [];
  setPluginThreadEventEmitter({
    emitThreadEvents: () => {},
    emitTerminalInput: () => {},
    emitHostDeleted: () => {},
    emitEnvironmentRemoved: () => {},
    emitThreadCreated: () => {},
    emitThreadActive: () => {},
    emitThreadIdle: () => {},
    emitThreadFailed: () => {},
    emitThreadArchived: () => {},
    emitThreadDeleted: () => {},
    emitThreadRead: () => {},
    emitInteractionPending: (_thread, interaction) =>
      announced.push(interaction.id),
    emitMessageQueued: () => {},
    emitMessageDispatched: () => {},
    emitMessageCancelled: () => {},
    emitThreadUnarchived: () => {},
    emitThreadParentChanged: () => {},
    emitTurnFailed: () => {},
  });
  return announced;
}

function parentAttentionNotices(harness: TestAppHarness, parentId: string) {
  return listQueuedThreadMessages(harness.db, parentId).filter(
    (row) =>
      row.systemNotice !== null &&
      JSON.parse(row.systemNotice).kind === "child-needs-attention",
  );
}

async function settleParentNotices(
  harness: TestAppHarness,
  parentId: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (
    parentAttentionNotices(harness, parentId).length < expected &&
    Date.now() < deadline
  ) {
    await sleep(10);
  }
  await sleep(NOTICE_SETTLE_MS);
}

function providerRoutePath(
  name: string,
  payload: (suffix: string) => PendingInteractionCreate["payload"],
): CreationPath {
  return {
    name,
    create: async ({ child, harness, sessionId }) => {
      const turnId = `turn-${child.id}`;
      const providerThreadId = `provider-${child.id}`;
      seedTurnStarted(harness.deps, {
        threadId: child.id,
        turnId,
        providerThreadId,
      });
      const body = JSON.stringify({
        sessionId,
        interaction: {
          threadId: child.id,
          turnId,
          providerId: "codex",
          providerThreadId,
          providerRequestId: `request-${child.id}`,
          payload: payload(child.id),
        },
      });
      const post = () =>
        harness.app.request("/internal/session/interactive-request", {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body,
        });
      await expect(readJson(await post())).resolves.toMatchObject({
        outcome: "created",
      });
      await expect(readJson(await post())).resolves.toMatchObject({
        outcome: "existing",
      });
      return async () => {};
    },
  };
}

const creationPaths: CreationPath[] = [
  providerRoutePath("provider command approval", (suffix) =>
    createCommandApprovalPayload({
      itemId: `item-${suffix}`,
      command: "git push",
      cwd: "/tmp/project",
    }),
  ),
  providerRoutePath("provider user question", () =>
    createUserQuestionPayload({ prompt: "Which storage?" }),
  ),
  providerRoutePath("provider plugin-defined request", () => ({
    kind: "secrets/secret-request",
    title: "Add a token",
    data: { fields: ["TOKEN"] },
  })),
  {
    name: "plugin card",
    create: async ({ child, harness }) => {
      const controller = new AbortController();
      const pending = harness.deps.pendingInteractions.requestPluginInteraction(
        {
          pluginId: "ask-user-question",
          threadId: child.id,
          rendererId: "ask-user-question",
          title: "Choose storage",
          payload: { questions: [] },
          presentation: {
            label: { pending: "Asking a question", completed: "Asked" },
            icon: { glyph: "MessageQuestion" },
          },
          describeSubmission: null,
          timeoutMs: 60_000,
          owner: { pluginId: "ask-user-question" },
          signal: controller.signal,
        },
      );
      return async () => {
        controller.abort();
        await pending;
      };
    },
  },
];

interface ChildCase {
  name: string;
  parentNotifications: ThreadParentNotifications;
  originKind: "fork" | null;
  notices: number;
}

const childCases: ChildCase[] = [
  {
    name: "an auto child",
    parentNotifications: "auto",
    originKind: null,
    notices: 1,
  },
  {
    name: "a stuck child",
    parentNotifications: "stuck",
    originKind: null,
    notices: 1,
  },
  {
    name: "an off child",
    parentNotifications: "off",
    originKind: null,
    notices: 0,
  },
  {
    name: "a fork child",
    parentNotifications: "auto",
    originKind: "fork",
    notices: 0,
  },
];

const table = creationPaths.flatMap((path) =>
  childCases.map((childCase) => ({ path, childCase })),
);

describe("every interaction creation path notifies the parent", () => {
  it.each(table)(
    "$path.name in $childCase.name",
    async ({ path, childCase }) => {
      await withTestHarness(async (harness) => {
        holdParentDeliveries();
        const announced = recordPendingAnnouncements();
        harness.deps.pendingInteractions.setPluginDirectory({
          isLoaded: (pluginId) => pluginId === "secrets",
        });
        const { host, session } = seedHostSession(harness.deps, {
          id: "host-interaction-parent-notice",
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const parent = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          title: "Coordinator",
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: `provider-${parent.id}`,
          threadId: parent.id,
        });
        const child = seedThread(harness.deps, {
          environmentId: environment.id,
          originKind: childCase.originKind,
          parentNotifications: childCase.parentNotifications,
          parentThreadId: parent.id,
          projectId: project.id,
          status: "active",
          title: "Worker",
        });

        const cleanup = await path.create({
          child,
          harness,
          sessionId: session.id,
        });
        try {
          await settleParentNotices(harness, parent.id, childCase.notices);
          const [interaction, ...others] =
            harness.deps.pendingInteractions.listPendingThreadInteractions(
              child.id,
            );
          expect(others).toEqual([]);
          expect(announced).toEqual([interaction?.id]);
          const notices = parentAttentionNotices(harness, parent.id);
          expect(notices).toHaveLength(childCase.notices);
          for (const notice of notices) {
            expect(notice.content).toContain(`@thread:${child.id}`);
          }
        } finally {
          await cleanup();
        }
      });
    },
  );
});

function* productionSources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* productionSources(path);
    } else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
      yield path;
    }
  }
}

describe("interaction creation ownership", () => {
  it("inserts pending interactions only from the lifecycle's announcing create", () => {
    const callers: string[] = [];
    for (const workspace of ["apps", "packages", "plugins"]) {
      for (const name of readdirSync(join(REPO_ROOT, workspace))) {
        const src = join(REPO_ROOT, workspace, name, "src");
        if (!existsSync(src)) continue;
        for (const file of productionSources(src)) {
          const calls = readFileSync(file, "utf8").match(INSERT_CALL) ?? [];
          callers.push(
            ...calls.map(() => relative(REPO_ROOT, file).split(sep).join("/")),
          );
        }
      }
    }
    expect(callers).toEqual([
      "apps/server/src/services/interactions/pending-interactions.ts",
    ]);
  });
});
