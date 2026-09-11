// @vitest-environment jsdom

import type { ReactNode } from "react";
import { webcrypto } from "node:crypto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftContentSchema, type Draft } from "@bb/server-contract";
import { useDraftResource } from "./useDraftResource";
import { getDraftResourceStore } from "@/lib/drafts/resource-runtime";
import {
  draftResourceApi,
  draftResourceQueryKey,
} from "@/lib/drafts/resource-api";
import {
  browserDraftRecoveryStorage,
  readDraftRecoveries,
} from "@/lib/drafts/recovery";
import { DraftResourceStore } from "@/lib/drafts/resource-store";
import {
  importLegacyNewThreadDraft,
  LEGACY_DRAFT_IMPORT_PREFIX,
  LEGACY_NEW_THREAD_DRAFT_KEY,
} from "@/lib/drafts/legacy-import";

const id = "drf_hook_resource";
const content = draftContentSchema.parse({
  prompt: { text: "Saved contents" },
});
const saved: Draft = { id, content, revision: 1, createdAt: 1, updatedAt: 1 };
const stores: DraftResourceStore[] = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

function createClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  });
  clients.push(client);
  return client;
}

function stubErrorResponse(code: string) {
  const network = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          code,
          message:
            code === "draft_gone"
              ? "Draft was deleted or submitted"
              : "This draft revision was submitted, but its thread has since been deleted",
          ...(code === "draft_submitted_thread_gone"
            ? { details: { threadId: "thr_submitted" } }
            : {}),
        }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", network);
  return network;
}

afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.dispose();
  for (const client of clients.splice(0)) client.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("mounted draft resource snapshots", () => {
  it("keeps snapshots stable across observer option changes and updates once for changed data", async () => {
    const queryClient = createClient();
    queryClient.setQueryData(draftResourceQueryKey(id), saved);
    const store = getDraftResourceStore(queryClient);
    stores.push(store);
    const initialSnapshot = store.getSnapshot(id);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(id, listener);
    let observerOptionUpdates = 0;
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "observerOptionsUpdated") observerOptionUpdates += 1;
    });
    let renders = 0;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    const { result, rerender } = renderHook(
      ({ renderKey }) => {
        renders += 1;
        if (renders > 20) throw new Error("Draft observer rerender loop");
        const resource = useDraftResource(id);
        return { resource, renderKey };
      },
      { initialProps: { renderKey: 0 }, wrapper: Wrapper },
    );
    expect(result.current.resource.promptDraft.text).toBe("Saved contents");
    rerender({ renderKey: 1 });
    rerender({ renderKey: 2 });
    await act(async () => {});
    expect(observerOptionUpdates).toBeGreaterThan(0);
    expect(store.getSnapshot(id)).toBe(initialSnapshot);
    expect(listener).not.toHaveBeenCalled();
    act(() => {
      queryClient.setQueryData(draftResourceQueryKey(id), {
        ...saved,
        revision: 2,
        content: draftContentSchema.parse({
          prompt: { text: "Changed remotely" },
        }),
      });
    });
    await waitFor(() =>
      expect(result.current.resource.promptDraft.text).toBe("Changed remotely"),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    const changedSnapshot = store.getSnapshot(id);
    act(() => {
      queryClient.setQueryData<Draft>(
        draftResourceQueryKey(id),
        (previous) => previous,
      );
    });
    expect(store.getSnapshot(id)).toBe(changedSnapshot);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(renders).toBeLessThan(10);
    unsubscribe();
    unsubscribeCache();
  });
});

describe("draft HTTP gone responses", () => {
  it("maps the shipped draft_gone GET response to a deleted resource", async () => {
    stubErrorResponse("draft_gone");
    await expect(draftResourceApi.get(id)).resolves.toBeNull();
    const queryClient = createClient();
    const store = new DraftResourceStore(
      queryClient,
      draftResourceApi,
      browserDraftRecoveryStorage(),
      60_000,
    );
    stores.push(store);
    queryClient.setQueryData(draftResourceQueryKey(id), saved);
    store.edit(id, (value) => ({
      ...value,
      prompt: { ...value.prompt, text: "Unsaved recovery" },
    }));
    await expect(store.flush(id)).rejects.toMatchObject({
      status: 410,
      code: "draft_gone",
    });
    expect(store.getSnapshot(id).status).toBe("deleted");
    expect(store.getSnapshot(id).content?.prompt.text).toBe("");
    expect(store.getSnapshot(id).recoveryCopies[0]?.prompt.text).toBe(
      "Unsaved recovery",
    );
  });

  it("recognizes a gone draft during submit without retaining an unaccepted submission", async () => {
    stubErrorResponse("draft_gone");
    const queryClient = createClient();
    queryClient.setQueryData(draftResourceQueryKey(id), saved);
    const store = new DraftResourceStore(
      queryClient,
      draftResourceApi,
      browserDraftRecoveryStorage(),
      60_000,
    );
    stores.push(store);
    await expect(store.submit(id)).rejects.toMatchObject({
      status: 410,
      code: "draft_gone",
    });
    expect(store.getSnapshot(id).status).toBe("deleted");
    expect(
      readDraftRecoveries(browserDraftRecoveryStorage(), id).records[0]?.value
        .submission,
    ).toBeNull();
    expect(store.getSnapshot(id).recoveryCopies[0]).toEqual(content);
  });

  it("retains the submitted revision when the receipt reports its thread was deleted", async () => {
    const network = stubErrorResponse("draft_submitted_thread_gone");
    await expect(draftResourceApi.get(id)).rejects.toMatchObject({
      code: "draft_submitted_thread_gone",
    });
    const queryClient = createClient();
    queryClient.setQueryData(draftResourceQueryKey(id), saved);
    const store = new DraftResourceStore(
      queryClient,
      draftResourceApi,
      browserDraftRecoveryStorage(),
      60_000,
    );
    stores.push(store);
    await expect(store.submit(id)).rejects.toMatchObject({
      status: 410,
      code: "draft_submitted_thread_gone",
    });
    expect(store.getSnapshot(id).status).toBe("error");
    expect(store.getSnapshot(id).content).toEqual(content);
    const recovery = readDraftRecoveries(browserDraftRecoveryStorage(), id)
      .records[0]?.value;
    expect(recovery?.submission).toEqual({ revision: 1, content });
    await expect(store.retry(id)).rejects.toMatchObject({
      code: "draft_submitted_thread_gone",
    });
    expect(
      network.mock.calls
        .slice(1)
        .every(
          ([, init]) => JSON.parse(String(init?.body)).expectedRevision === 1,
        ),
    ).toBe(true);
  });

  it("clears an acknowledged legacy value after the server reports its imported draft is gone", async () => {
    const rawValue = JSON.stringify(content.prompt);
    const bytes = new TextEncoder().encode(rawValue);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const importedId = `drf_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    localStorage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, rawValue);
    localStorage.setItem(
      `${LEGACY_DRAFT_IMPORT_PREFIX}${importedId}`,
      JSON.stringify({
        version: 1,
        id: importedId,
        rawValue,
        content,
        acknowledged: true,
      }),
    );
    const network = stubErrorResponse("draft_gone");
    const result = await importLegacyNewThreadDraft(
      {},
      {
        api: draftResourceApi,
        storage: browserDraftRecoveryStorage(),
        queryClient: createClient(),
      },
    );
    expect(result).toMatchObject({ id: importedId, draft: null, error: null });
    expect(localStorage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });
});
