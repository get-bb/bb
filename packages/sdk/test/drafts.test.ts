import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { DraftContent, DraftUpdateArgs } from "@bb/sdk";
import type { DraftUpdateArgs as BrowserDraftUpdateArgs } from "@bb/sdk/browser";
import type { DraftUpdateArgs as CoreDraftUpdateArgs } from "@bb/sdk/core";
import type { DraftUpdateArgs as NodeDraftUpdateArgs } from "@bb/sdk/node";
import { draftSchema } from "@bb/server-contract";
import type { ThreadWithRuntime } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { BbHttpError, type FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

const draft = draftSchema.parse({
  id: "drf_sdk_roundtrip",
  revision: 7,
  createdAt: 1,
  updatedAt: 2,
  content: {
    projectId: "proj_test",
    sectionId: "section_test",
    prompt: {
      text: "@Previous\nFollow up",
      mentions: [
        {
          start: 0,
          end: 9,
          resource: {
            kind: "thread",
            threadId: "thr_previous",
            label: "Previous",
          },
        },
      ],
      attachments: [
        {
          type: "localFile",
          path: "/uploads/a.txt",
          name: "a.txt",
          sizeBytes: 42,
        },
      ],
    },
    options: {
      providerId: "provider_test",
      model: "model_test",
      reasoningLevel: "high",
      serviceTier: "fast",
      permissionMode: "auto",
      environment: {
        type: "provider",
        environmentProviderId: "custom-worktree",
        machine: null,
        inputs: { branch: "feature" },
      },
      title: "Draft example",
      parentThreadId: "thr_parent",
      sourceThreadId: null,
      sourceSeqEnd: null,
      originKind: null,
      sendAt: 10,
    },
  },
});

const thread: ThreadWithRuntime = {
  id: "thr_submitted",
  projectId: "proj_test",
  environmentId: null,
  providerId: "provider_test",
  title: "Draft example",
  titleFallback: null,
  sectionId: "section_test",
  status: "pending",
  parentThreadId: "thr_parent",
  sourceThreadId: null,
  originKind: null,
  originPluginId: null,
  visibility: "visible",
  archivedAt: null,
  pinnedAt: null,
  deletedAt: null,
  lastReadAt: null,
  latestAttentionAt: 1,
  createdAt: 1,
  updatedAt: 1,
  runtime: { displayStatus: "pending", hostReconnectGraceExpiresAt: null },
};

function sdkWithResponses(responses: Response[]) {
  const fetch = vi.fn<FetchImplementation>(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error("Unexpected SDK request");
    return response;
  });
  return {
    fetch,
    sdk: createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch,
      }),
    }),
  };
}

describe("draft SDK", () => {
  it("exposes revision-required content mutations through every public entrypoint", () => {
    expectTypeOf<DraftUpdateArgs>().toEqualTypeOf<BrowserDraftUpdateArgs>();
    expectTypeOf<DraftUpdateArgs>().toEqualTypeOf<CoreDraftUpdateArgs>();
    expectTypeOf<DraftUpdateArgs>().toEqualTypeOf<NodeDraftUpdateArgs>();
    expectTypeOf<DraftUpdateArgs["expectedRevision"]>().toEqualTypeOf<number>();
    expectTypeOf(draft.content).toEqualTypeOf<DraftContent>();
  });

  it("round trips complete content without leaking draftId into strict mutation bodies", async () => {
    const updated = { ...draft, revision: 8 };
    const { sdk, fetch } = sdkWithResponses([
      Response.json({ id: draft.id, draft }),
      Response.json(updated),
      Response.json({ id: draft.id, revision: 9 }),
    ]);
    await expect(
      sdk.drafts.create({ id: draft.id, content: draft.content }),
    ).resolves.toEqual({ id: draft.id, draft });
    await expect(
      sdk.drafts.update({
        draftId: draft.id,
        expectedRevision: 7,
        content: draft.content,
      }),
    ).resolves.toEqual(updated);
    await sdk.drafts.delete({ draftId: draft.id, expectedRevision: 8 });

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        url: String(url),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      })),
    ).toEqual([
      {
        url: "http://bb.test/api/v1/drafts",
        method: "POST",
        body: { id: draft.id, content: draft.content },
      },
      {
        url: `http://bb.test/api/v1/drafts/${draft.id}`,
        method: "PATCH",
        body: { expectedRevision: 7, content: draft.content },
      },
      {
        url: `http://bb.test/api/v1/drafts/${draft.id}`,
        method: "DELETE",
        body: { expectedRevision: 8 },
      },
    ]);
  });

  it("preserves explicit false and zero query values and read cancellation", async () => {
    const { sdk, fetch } = sdkWithResponses([
      Response.json({ drafts: [draft], nextOffset: 1 }),
      Response.json(draft),
      Response.json({ drafts: [], nextOffset: null }),
    ]);
    const controller = new AbortController();
    await expect(
      sdk.drafts.list({
        projectId: "proj_test",
        query: "Follow up & next",
        includeEmpty: false,
        limit: 1,
        offset: 0,
        signal: controller.signal,
      }),
    ).resolves.toEqual({ drafts: [draft], nextOffset: 1 });
    await expect(
      sdk.drafts.get({ draftId: draft.id, signal: controller.signal }),
    ).resolves.toEqual(draft);
    await sdk.drafts.list();

    const listUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      projectId: "proj_test",
      query: "Follow up & next",
      includeEmpty: "false",
      limit: "1",
      offset: "0",
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(fetch.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
    const defaultListUrl = new URL(String(fetch.mock.calls[2]?.[0]));
    expect(defaultListUrl.pathname).toBe("/api/v1/drafts");
    expect(defaultListUrl.search).toBe("");
  });

  it("keeps consumed creation receipts and repeated submit results intact", async () => {
    const newer = { ...draft, revision: 8 };
    const { sdk, fetch } = sdkWithResponses([
      Response.json({ id: draft.id, draft: null }),
      Response.json({ thread, draft: newer }),
      Response.json({ thread, draft: newer }),
    ]);
    await expect(
      sdk.drafts.create({ id: draft.id, content: draft.content }),
    ).resolves.toEqual({ id: draft.id, draft: null });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        sdk.drafts.submit({
          draftId: draft.id,
          expectedRevision: 7,
          origin: "sdk",
        }),
      ).resolves.toEqual({ thread, draft: newer });
    }
    expect(
      fetch.mock.calls.slice(1).map(([url, init]) => ({
        url: String(url),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      })),
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        url: `http://bb.test/api/v1/drafts/${draft.id}/submit`,
        method: "POST",
        body: { expectedRevision: 7, origin: "sdk" },
      })),
    );
  });

  it("surfaces revision conflicts without retrying or losing the response body", async () => {
    const conflict = {
      code: "draft_revision_conflict",
      message: "Draft changed",
      draft,
    };
    const { sdk, fetch } = sdkWithResponses([
      Response.json(conflict, { status: 409 }),
    ]);
    const request = sdk.drafts.update({
      draftId: draft.id,
      expectedRevision: 6,
      content: draft.content,
    });
    await expect(request).rejects.toBeInstanceOf(BbHttpError);
    await expect(request).rejects.toMatchObject({
      status: 409,
      body: conflict,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed successful responses before callers treat them as durable", async () => {
    const { sdk } = sdkWithResponses([
      Response.json({ ...draft, revision: 0 }),
      Response.json({ id: draft.id }),
    ]);
    await expect(sdk.drafts.get({ draftId: draft.id })).rejects.toThrow();
    await expect(sdk.drafts.create()).rejects.toThrow();
  });
});
