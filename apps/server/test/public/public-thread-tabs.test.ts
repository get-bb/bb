import { threadTabsResponseSchema, type ThreadTab } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function getTabs(
  harness: TestAppHarness,
  threadId: string,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/tabs`);
}

async function putTabs(
  harness: TestAppHarness,
  threadId: string,
  body: { expectedRevision: number; tabs: readonly ThreadTab[] },
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/tabs`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

const ALL_TAB_KINDS: readonly ThreadTab[] = [
  { id: "thread-info", kind: "thread-info" },
  { id: "git-diff", kind: "git-diff" },
  {
    actionId: "inspect",
    id: "plugin-panel",
    kind: "plugin-panel",
    paramsJson: '{"path":"src/index.ts"}',
    pluginId: "example",
    title: "Inspector",
  },
  {
    environmentId: "env_1",
    id: "workspace-file",
    kind: "workspace-file-preview",
    lineRange: { endLineNumber: 12, startLineNumber: 8 },
    path: "src/index.ts",
    projectId: "prj_1",
    source: { kind: "merge-base", ref: "main" },
    statusLabel: null,
  },
  {
    environmentId: "env_1",
    id: "host-file",
    kind: "host-file-preview",
    lineRange: null,
    path: "/tmp/output.log",
    threadId: "thr_child",
  },
  {
    environmentId: "env_1",
    id: "thread-storage-file",
    isPinned: true,
    kind: "thread-storage-file-preview",
    lineRange: null,
    path: "notes/result.md",
    threadId: "thr_child",
  },
  {
    environmentId: "env_1",
    id: "browser",
    kind: "browser",
    title: "Example",
    url: "https://example.com",
  },
  { id: "new-tab", kind: "new-tab" },
  {
    id: "side-chat",
    kind: "side-chat",
    sourceMessageText: "Investigate this part",
    sourceSeqEnd: 42,
    threadId: "thr_child",
    title: "Investigate",
  },
  { id: "terminal", kind: "terminal", terminalId: "term_1" },
];

describe("public thread tabs", () => {
  it("stores every tab kind and rejects stale writes", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const initialResponse = await getTabs(harness, thread.id);
      expect(initialResponse.status).toBe(200);
      expect(
        threadTabsResponseSchema.parse(await readJson(initialResponse)),
      ).toEqual({ revision: 0, tabs: [] });

      const updateResponse = await putTabs(harness, thread.id, {
        expectedRevision: 0,
        tabs: ALL_TAB_KINDS,
      });
      expect(updateResponse.status).toBe(200);
      expect(
        threadTabsResponseSchema.parse(await readJson(updateResponse)),
      ).toEqual({ revision: 1, tabs: ALL_TAB_KINDS });

      const staleResponse = await putTabs(harness, thread.id, {
        expectedRevision: 0,
        tabs: [],
      });
      expect(staleResponse.status).toBe(409);
      expect(await readJson(staleResponse)).toEqual({
        code: "thread_tabs_conflict",
        details: { currentRevision: 1 },
        message: "Thread tabs changed on another client",
      });

      const persistedResponse = await getTabs(harness, thread.id);
      expect(
        threadTabsResponseSchema.parse(await readJson(persistedResponse)),
      ).toEqual({ revision: 1, tabs: ALL_TAB_KINDS });
    });
  });

  it("rejects duplicate tab ids and unknown threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const duplicateResponse = await putTabs(harness, thread.id, {
        expectedRevision: 0,
        tabs: [
          { id: "same", kind: "thread-info" },
          { id: "same", kind: "git-diff" },
        ],
      });
      expect(duplicateResponse.status).toBe(400);

      expect((await getTabs(harness, "thr_missing")).status).toBe(404);
    });
  });
});
