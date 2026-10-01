import { createPromptHistoryEntry } from "@bb/db";
import { promptHistoryListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public prompt history list route", () => {
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
      const middle = seed(first.id, 2, "Fix the login test", 20);
      const newest = seed(second.id, 1, "Write release notes", 30);
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
          createdAt: 30,
          input: textInput("Write release notes"),
          projectId: project.id,
          threadId: second.id,
        },
        {
          id: middle.id,
          createdAt: 20,
          input: textInput("Fix the login test"),
          projectId: project.id,
          threadId: first.id,
        },
      ]);
      if (firstPage.nextCursor === null) throw new Error("expected a cursor");

      const secondPage = await page(`limit=2&cursor=${firstPage.nextCursor}`);
      expect(secondPage.entries.map((entry) => entry.id)).toEqual([oldest.id]);
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
