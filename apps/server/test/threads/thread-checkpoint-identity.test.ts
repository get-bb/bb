import { fileURLToPath } from "node:url";
import { createScriptedEchoRuntime } from "@bb/agent-runtime/test";
import { getThread, listEvents } from "@bb/db";
import type { PromptInput, ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import { editThreadMessage } from "../../src/services/threads/thread-edit-message.js";
import {
  internalAuthHeaders,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const bridgePath = fileURLToPath(
  new URL(
    "../../../../plugins/provider-codex/src/bridge/bridge.ts",
    import.meta.url,
  ),
);
const appServerPath = fileURLToPath(
  new URL(
    "../../../../plugins/provider-codex/src/bridge/fake-codex-app-server.mjs",
    import.meta.url,
  ),
);
const execution = {
  model: "test-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
} as const;
const options = {
  ...execution,
  permissionScope: "full",
  providerOptions: {},
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

describe("checkpoint identity through runtime, ingestion, and editing", () => {
  it.each(["fork", "resume"] as const)(
    "preserves the %s session and checkpoint through SQLite and rewind preparation",
    async (construction) => {
      await withTestHarness(async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          status: "ready",
        });
        const source = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });
        const sibling = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });
        const events: ThreadEvent[] = [];
        const runtime = createScriptedEchoRuntime({
          launch: { modulePath: bridgePath },
          runtime: {
            workspacePath: harness.config.dataDir,
            env: {
              BB_CODEX_BRIDGE_APP_SERVER_COMMAND: process.execPath,
              BB_CODEX_BRIDGE_APP_SERVER_ARGS: JSON.stringify([appServerPath]),
            },
            onEvent: (event) => events.push(event),
          },
        });
        let posted = 0;
        async function ingest() {
          const batch = events.slice(posted);
          const response = await harness.app.request(
            "/internal/session/events",
            {
              method: "POST",
              headers: internalAuthHeaders(harness),
              body: JSON.stringify({
                sessionId: session.id,
                eventGroups: groupHostDaemonEvents(
                  batch.map((event) => ({ threadId: event.threadId, event })),
                ),
              }),
            },
          );
          expect(response.status, await response.text()).toBe(200);
          posted = events.length;
        }
        const args = {
          environmentId: environment.id,
          projectId: project.id,
          providerId: "codex",
          options,
          threadId: source.id,
        };
        try {
          const original =
            construction === "fork"
              ? await runtime.startThread({
                  ...args,
                  fork: { sourceProviderThreadId: "historical-source" },
                })
              : await runtime.resumeThread({
                  ...args,
                  providerThreadId: "historical-source",
                });
          await runtime.startThread({ ...args, threadId: sibling.id });
          await ingest();
          const requests: number[] = [];
          for (const text of ["first", "second"]) {
            const input: PromptInput[] = [{ type: "text", text, mentions: [] }];
            const request = appendClientTurnEvent(harness.deps, {
              type: "client/turn/requested",
              threadId: source.id,
              environmentId: environment.id,
              execution,
              initiator: "user",
              senderThreadId: null,
              input,
              target: { kind: "new-turn" },
              requestMethod: "turn/start",
              source: "tell",
            });
            requests.push(request.sequence);
            const start = events.length;
            await runtime.runTurn({
              threadId: source.id,
              input,
              options,
              clientRequestId: request.requestId,
            });
            await vi.waitFor(() =>
              expect(
                events
                  .slice(start)
                  .some((event) => event.type === "turn/completed"),
              ).toBe(true),
            );
            await ingest();
          }
          const storedCompletions = listEvents(harness.db, {
            threadId: source.id,
          }).filter((event) => event.type === "turn/completed");
          const thread = getThread(harness.db, source.id);
          if (!thread) throw new Error("Missing source thread");
          const edit = editThreadMessage(harness.deps, {
            environment,
            thread,
            payload: {
              operationId: `edit-identity-${construction}`,
              expectedRequestSequence: requests[1],
              input: [{ type: "text", text: "replacement", mentions: [] }],
            },
          });
          const rewind = await waitForQueuedCommand(
            harness,
            (queued) => queued.command.type === "thread.rewind.prepare",
          );
          if (rewind.command.type !== "thread.rewind.prepare")
            throw new Error("Expected rewind preparation");
          const prepared = await runtime.prepareThreadRewind({
            ...args,
            leaseId: rewind.command.leaseId,
            sourceProviderThreadId: rewind.command.sourceProviderThreadId,
            retainThroughProviderCheckpoint:
              rewind.command.retainThroughProviderCheckpoint,
          });
          await reportQueuedCommandSuccess(harness, rewind, prepared);
          await expect(edit).resolves.toMatchObject({ ok: true });
          await runtime.discardThreadRewind({
            leaseId: rewind.command.leaseId,
          });
          expect(
            storedCompletions.map((event) => JSON.parse(event.data)),
          ).toEqual([
            expect.objectContaining({
              providerThreadId: original.providerThreadId,
              providerCheckpointId: "turn-fx-1",
            }),
            expect.objectContaining({
              providerThreadId: original.providerThreadId,
              providerCheckpointId: "turn-fx-2",
            }),
          ]);
          expect(rewind.command).toMatchObject({
            sourceProviderThreadId: original.providerThreadId,
            retainThroughProviderCheckpoint: "turn-fx-1",
          });
        } finally {
          await runtime.shutdown();
        }
      });
    },
    20_000,
  );
});
