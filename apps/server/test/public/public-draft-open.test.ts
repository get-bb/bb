import { getStoredDraft } from "@bb/db";
import { draftCreateResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function createDraft(harness: TestAppHarness): Promise<string> {
  const response = await harness.app.request("/api/v1/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: { prompt: { text: "Saved work" } } }),
  });
  expect(response.status).toBe(201);
  return draftCreateResponseSchema.parse(await readJson(response)).id;
}

function open(
  harness: TestAppHarness,
  id: string,
  body: unknown,
  origin?: string,
) {
  return harness.app.request(`/api/v1/drafts/${id}/open`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("public draft open", () => {
  it("opens without an app and broadcasts placement without changing the resource", async () => {
    await withTestHarness(async (harness) => {
      const id = await createDraft(harness);
      const before = getStoredDraft(harness.db, id);
      expect(await readJson(await open(harness, id, {}))).toEqual({
        delivered: 0,
      });
      const first = createMockHubSocket();
      const second = createMockHubSocket();
      harness.deps.hub.registerClient(first);
      harness.deps.hub.registerClient(second);
      for (const split of [
        undefined,
        "right",
        "down",
        "left",
        "top",
        "replace",
      ]) {
        const response = await open(
          harness,
          id,
          split === undefined ? {} : { split },
        );
        expect(response.status).toBe(200);
        expect(await readJson(response)).toEqual({ delivered: 2 });
        expect(JSON.parse(first.messages.at(-1)!)).toEqual({
          type: "draft-open",
          draftId: id,
          split: split ?? "replace",
        });
      }
      expect(first.messages).toEqual(second.messages);
      expect(getStoredDraft(harness.db, id)).toEqual(before);
    });
  });

  it("rejects missing, deleted, invalid, and cross-origin opens without sending", async () => {
    await withTestHarness(async (harness) => {
      const id = await createDraft(harness);
      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket);
      expect((await open(harness, "drf_missing_draft", {})).status).toBe(404);
      expect((await open(harness, id, { split: "diagonal" })).status).toBe(400);
      expect(
        (await open(harness, id, { browserId: "unimplemented" })).status,
      ).toBe(400);
      expect(
        (await open(harness, id, {}, "https://untrusted.example")).status,
      ).toBe(403);
      const deletion = await harness.app.request(`/api/v1/drafts/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: 1 }),
      });
      expect(deletion.status).toBe(200);
      socket.messages.length = 0;
      expect((await open(harness, id, {})).status).toBe(404);
      expect(socket.messages).toHaveLength(0);
    });
  });
});
