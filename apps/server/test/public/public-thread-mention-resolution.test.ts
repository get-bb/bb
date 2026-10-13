import { archiveThread, markThreadDeleted } from "@bb/db";
import { GENERATED_ID_ALPHABET, GENERATED_ID_SUFFIX_LENGTH } from "@bb/domain";
import { resolveThreadMentionsResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function validThreadId(index: number): string {
  let value = index;
  let suffix = "";
  for (let position = 0; position < GENERATED_ID_SUFFIX_LENGTH; position += 1) {
    suffix =
      GENERATED_ID_ALPHABET[value % GENERATED_ID_ALPHABET.length] + suffix;
    value = Math.floor(value / GENERATED_ID_ALPHABET.length);
  }
  return `thr_${suffix}`;
}

async function resolveMentionsRequest(
  harness: TestAppHarness,
  threadIds: readonly string[],
): Promise<Response> {
  return harness.app.request("/api/v1/threads/resolve-mentions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadIds }),
  });
}

describe("public thread mention resolution route", () => {
  it("deduplicates exact IDs and omits missing or deleted threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const known = seedThread(harness.deps, {
        projectId: project.id,
        title: "Known mention target",
      });
      const archived = seedThread(harness.deps, {
        projectId: project.id,
        title: "Archived mention target",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archived.id);
      const deleted = seedThread(harness.deps, {
        projectId: project.id,
        title: "Deleted mention target",
      });
      markThreadDeleted(harness.deps.db, harness.deps.hub, {
        threadId: deleted.id,
      });

      const response = await resolveMentionsRequest(harness, [
        archived.id,
        known.id,
        known.id,
        deleted.id,
        validThreadId(999),
      ]);

      expect(response.status).toBe(200);
      expect(
        resolveThreadMentionsResponseSchema.parse(await readJson(response)),
      ).toEqual([
        {
          threadId: archived.id,
          projectId: project.id,
          label: "Archived mention target",
        },
        {
          threadId: known.id,
          projectId: project.id,
          label: "Known mention target",
        },
      ]);
    });
  });

  it("rejects an ID outside the raw thread-ID grammar at the route boundary", async () => {
    await withTestHarness(async (harness) => {
      const invalidId = await resolveMentionsRequest(harness, ["thr_legacy"]);
      expect(invalidId.status).toBe(400);
    });
  });
});
