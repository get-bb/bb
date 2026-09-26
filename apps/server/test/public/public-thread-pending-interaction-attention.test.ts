import {
  archiveThread,
  interruptPendingInteractionsForThreadIds,
} from "@bb/db";
import type { PendingInteractionCreate } from "@bb/domain";
import {
  threadPendingInteractionAttentionResponseSchema,
  type ThreadPendingInteractionAttentionResponse,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/types.js";
import { readJson } from "../helpers/json.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import {
  seedThread,
  seedThreadFixture,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function registerApproval(
  deps: Pick<AppDeps, "db" | "hub" | "pendingInteractions">,
  threadId: string,
  requestId: string,
): string {
  const interaction: PendingInteractionCreate = {
    threadId,
    turnId: `turn-${requestId}`,
    providerId: "codex",
    providerThreadId: `provider-${requestId}`,
    providerRequestId: requestId,
    payload: createCommandApprovalPayload({
      itemId: `item-${requestId}`,
      reason: "Approve command",
      command: `node -e "${requestId}"`,
      cwd: "/tmp/project",
    }),
  };
  seedTurnStarted(deps, {
    threadId,
    turnId: interaction.turnId,
    providerThreadId: interaction.providerThreadId,
  });
  const registered = deps.pendingInteractions.registerPendingInteraction({
    interaction,
  });
  if (registered.outcome === "rejected") {
    throw new Error(`Expected registration to succeed: ${registered.reason}`);
  }
  return registered.interaction.id;
}

async function listAttention(
  harness: TestAppHarness,
  query = "",
): Promise<ThreadPendingInteractionAttentionResponse> {
  const response = await harness.app.request(
    `/api/v1/threads/pending-interactions${query}`,
  );
  expect(response.status).toBe(200);
  return threadPendingInteractionAttentionResponseSchema.parse(
    await readJson(response),
  );
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("public thread pending interaction attention route", () => {
  it("lists a hidden worker's approval with its thread and lifecycle owner", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: origin,
      } = seedThreadFixture(harness, {
        session: { id: "host-attention-owner" },
      });
      const worker = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        title: "review:correctness",
        visibility: "hidden",
        lifecycleOwnerThreadId: origin.id,
        originPluginId: "workflows",
      });
      const interactionId = registerApproval(
        harness.deps,
        worker.id,
        "hidden-owned",
      );

      await expect(
        listAttention(harness, "?visibility=hidden"),
      ).resolves.toMatchObject([
        {
          interaction: {
            id: interactionId,
            threadId: worker.id,
            status: "pending",
            payload: { kind: "approval" },
          },
          thread: {
            id: worker.id,
            projectId: project.id,
            title: "review:correctness",
            visibility: "hidden",
            originPluginId: "workflows",
          },
          owner: { id: origin.id },
        },
      ]);
    });
  });

  it("filters by visibility and returns every active interaction by default", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: visible,
      } = seedThreadFixture(harness, {
        session: { id: "host-attention-visibility" },
      });
      const hidden = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      registerApproval(harness.deps, visible.id, "visible-thread");
      await tick();
      registerApproval(harness.deps, hidden.id, "hidden-thread");

      const threadIds = (entries: ThreadPendingInteractionAttentionResponse) =>
        entries.map((entry) => entry.thread.id);
      expect(
        threadIds(await listAttention(harness, "?visibility=hidden")),
      ).toEqual([hidden.id]);
      expect(
        threadIds(await listAttention(harness, "?visibility=visible")),
      ).toEqual([visible.id]);
      expect(threadIds(await listAttention(harness))).toEqual([
        hidden.id,
        visible.id,
      ]);
      expect(
        threadIds(await listAttention(harness, "?visibility=any")),
      ).toEqual([hidden.id, visible.id]);
    });
  });

  it("prefers the parent as owner and reports no owner for a root hidden thread", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: parent,
      } = seedThreadFixture(harness, {
        session: { id: "host-attention-parent" },
      });
      const lifecycleOwner = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const child = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
        parentThreadId: parent.id,
        lifecycleOwnerThreadId: lifecycleOwner.id,
      });
      const orphan = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      registerApproval(harness.deps, child.id, "parented");
      await tick();
      registerApproval(harness.deps, orphan.id, "orphan");

      const entries = await listAttention(harness, "?visibility=hidden");
      expect(
        entries.map((entry) => [entry.thread.id, entry.owner?.id ?? null]),
      ).toEqual([
        [orphan.id, null],
        [child.id, parent.id],
      ]);
    });
  });

  it("leaves out settled interactions and archived threads", async () => {
    await withTestHarness(async (harness) => {
      const {
        project,
        environment,
        thread: origin,
      } = seedThreadFixture(harness, {
        session: { id: "host-attention-settled" },
      });
      const settled = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      const archived = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      const owned = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
        lifecycleOwnerThreadId: origin.id,
      });
      registerApproval(harness.deps, settled.id, "settled");
      registerApproval(harness.deps, archived.id, "archived");
      registerApproval(harness.deps, owned.id, "owned-by-archived-origin");
      interruptPendingInteractionsForThreadIds(harness.deps.db, {
        statusReason: "test",
        threadIds: [settled.id],
      });
      archiveThread(harness.deps.db, harness.deps.hub, archived.id);
      archiveThread(harness.deps.db, harness.deps.hub, origin.id);

      await expect(listAttention(harness)).resolves.toEqual([]);
    });
  });

  it("returns newest first and enforces the limit range", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedThreadFixture(harness, {
        session: { id: "host-attention-limit" },
      });
      const first = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      const second = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        visibility: "hidden",
      });
      registerApproval(harness.deps, first.id, "older");
      await tick();
      registerApproval(harness.deps, second.id, "newer");

      const limited = await listAttention(harness, "?limit=1");
      expect(limited.map((entry) => entry.thread.id)).toEqual([second.id]);

      for (const limit of ["0", "201"]) {
        const response = await harness.app.request(
          `/api/v1/threads/pending-interactions?limit=${limit}`,
        );
        expect(response.status).toBe(400);
      }
    });
  });
});
