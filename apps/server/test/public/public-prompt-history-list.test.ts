import { createPromptHistoryEntry, listQueuedThreadMessages } from "@bb/db";
import { promptHistoryListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  readAttachment,
  storeAttachment,
} from "../../src/services/projects/attachments.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public prompt history list route", () => {
  it.each(["localImage", "localFile"] as const)(
    "restores history %s attachments into another project's queued prompt",
    async (type) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project: source } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const { project: destination } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const sourceThread = seedThread(harness.deps, { projectId: source.id });
        const destinationThread = seedThread(harness.deps, {
          projectId: destination.id,
        });
        const attachment = await storeAttachment(
          harness.deps.db,
          harness.deps.config.dataDir,
          source.id,
          new File(
            ["attachment bytes"],
            type === "localImage" ? "attachment.png" : "attachment.txt",
            {
              type: type === "localImage" ? "image/png" : "text/plain",
            },
          ),
        );
        createPromptHistoryEntry(harness.deps.db, {
          projectId: source.id,
          threadId: sourceThread.id,
          scope: "thread",
          requestSequence: 1,
          input: [
            ...textInput("Review this attachment"),
            { type, path: attachment.path },
          ],
        });

        const history = promptHistoryListResponseSchema.parse(
          await readJson(await harness.app.request("/api/v1/prompt-history")),
        );
        const input = history.entries[0]!.input;
        const response = await harness.app.request(
          `/api/v1/threads/${destinationThread.id}/queued-messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input,
              model: "gpt-5",
              reasoningLevel: "medium",
              permissionMode: "full",
              serviceTier: "default",
            }),
          },
        );

        expect(response.status, JSON.stringify(await readJson(response))).toBe(
          201,
        );
        expect(
          (
            await readAttachment(
              harness.deps.config.dataDir,
              destination.id,
              attachment.path,
            )
          ).content.toString(),
        ).toBe("attachment bytes");
        const queued = listQueuedThreadMessages(
          harness.deps.db,
          destinationThread.id,
        )[0]!;
        expect(JSON.parse(queued.content)).toEqual([
          ...textInput("Review this attachment"),
          { type, path: attachment.path },
        ]);
        const edited = await harness.app.request(
          `/api/v1/threads/${destinationThread.id}/queued-messages/${queued.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input,
              expectedUpdatedAt: queued.updatedAt,
            }),
          },
        );
        expect(edited.status).toBe(200);
        expect(
          listQueuedThreadMessages(harness.deps.db, destinationThread.id)[0]!
            .content,
        ).toBe(queued.content);
      });
    },
  );

  it("pages every prompt newest first with project and thread locations", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const first = seedThread(harness.deps, { projectId: project.id });
      const second = seedThread(harness.deps, { projectId: project.id });
      const seed = (
        threadId: string,
        requestSequence: number,
        text: string,
        createdAt: number,
      ) =>
        createPromptHistoryEntry(harness.deps.db, {
          projectId: project.id,
          threadId,
          scope: "thread",
          requestSequence,
          input: textInput(text),
          createdAt,
        });
      const oldest = seed(first.id, 1, "Investigate auth flow", 10);
      const older = seed(first.id, 2, "Fix the login test", 20);
      const newer = seed(second.id, 1, "Write release notes", 30);
      const newest = seed(second.id, 2, "Review release notes", 40);
      const page = async (query: string) =>
        promptHistoryListResponseSchema.parse(
          await readJson(
            await harness.app.request(`/api/v1/prompt-history?${query}`),
          ),
        );

      const firstPage = await page("limit=2");
      expect(firstPage.entries).toEqual([
        {
          id: newest.id,
          createdAt: 40,
          input: textInput("Review release notes"),
          projectId: project.id,
          threadId: second.id,
        },
        {
          id: newer.id,
          createdAt: 30,
          input: textInput("Write release notes"),
          projectId: project.id,
          threadId: second.id,
        },
      ]);
      if (firstPage.nextCursor === null) throw new Error("expected a cursor");

      const secondPage = await page(`limit=2&cursor=${firstPage.nextCursor}`);
      expect(secondPage.entries.map((entry) => entry.id)).toEqual([
        older.id,
        oldest.id,
      ]);
      expect(secondPage.nextCursor).toBeNull();
    });
  });

  it("rejects a malformed cursor or limit", async () => {
    await withTestHarness(async (harness) => {
      for (const url of [
        "/api/v1/prompt-history?cursor=not-a-cursor",
        "/api/v1/prompt-history?limit=bad",
        "/api/v1/prompt-history?limit=0",
      ]) {
        const response = await harness.app.request(url);
        expect(response.status, url).toBe(400);
      }
    });
  });
});
