// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPromptDraftState } from "@bb/client-core";
import {
  resolveSerializedPromptMentions,
  type ThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { sdk } from "@/lib/sdk";
import {
  resolveInitialPromptDraft,
  useInitialPromptDraft,
} from "./initial-prompt-draft";

const navigationState = vi.hoisted(() => ({ pending: false }));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: undefined,
    isPending: navigationState.pending,
  }),
}));

const resources: ThreadTitleMentionResources = {
  projectNamesById: new Map([["proj_app", "Application"]]),
  sectionNamesById: new Map([["sec_work", "Work"]]),
  threadById: new Map([
    [
      "thr_known",
      {
        id: "thr_known",
        projectId: "proj_app",
        title: "Real title",
        titleFallback: "Fallback",
      },
    ],
    [
      "thr_fallback",
      {
        id: "thr_fallback",
        projectId: "proj_app",
        title: null,
        titleFallback: "Fallback title",
      },
    ],
  ]),
};

function draft(text: string, source = resources) {
  return {
    text,
    mentions: resolveSerializedPromptMentions(text, source),
    attachments: [],
  };
}

afterEach(() => {
  cleanup();
  navigationState.pending = false;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("initial prompt mentions", () => {
  it("keeps UTF-16 offsets and resolves repeated tokens, titles, names and fallback titles", () => {
    const text =
      "😀 Hand off @thread:thr_known,\n@project:proj_app @section:sec_work @thread:thr_fallback @thread:thr_known.";
    const result = draft(text);
    expect(result.text).toBe(text);
    expect(
      result.mentions.map(({ start, end, resource }) => ({
        start,
        end,
        token: text.slice(start, end),
        label: resource.label,
      })),
    ).toEqual([
      { start: 12, end: 29, token: "@thread:thr_known", label: "Real title" },
      { start: 31, end: 48, token: "@project:proj_app", label: "Application" },
      { start: 49, end: 66, token: "@section:sec_work", label: "Work" },
      {
        start: 67,
        end: 87,
        token: "@thread:thr_fallback",
        label: "Fallback title",
      },
      { start: 88, end: 105, token: "@thread:thr_known", label: "Real title" },
    ]);
  });

  it("leaves ordinary text, raw IDs, paths and malformed token boundaries alone", () => {
    expect(
      draft(
        "thr_known @src/app.ts @folder:sec_work user@thread:thr_known @thread:thr_known/path @project: @section:sec_work.json",
      ).mentions,
    ).toEqual([]);
    const text = "@src/app.ts @thread:thr_known";
    expect(draft(text).mentions[0]).toMatchObject({
      start: 12,
      end: text.length,
    });
  });

  it("resolves remote threads once and preserves missing-ID fallbacks", async () => {
    const lookup = vi
      .fn<typeof sdk.threads.resolveMentions>()
      .mockResolvedValue([
        {
          threadId: "thr_abcdefghij",
          projectId: "proj_remote",
          label: "Remote title",
        },
      ]);
    const result = await resolveInitialPromptDraft(
      draft(
        "@thread:thr_abcdefghij @thread:thr_abcdefghij @thread:thr_23456789ab @project:missing @section:missing",
      ),
      lookup,
      new AbortController().signal,
    );
    expect(lookup).toHaveBeenCalledWith({
      threadIds: ["thr_abcdefghij", "thr_23456789ab"],
      signal: expect.any(AbortSignal),
    });
    expect(result.mentions.map(({ resource }) => resource.label)).toEqual([
      "Remote title",
      "Remote title",
      "Unavailable thread",
      "missing",
      "missing",
    ]);
    expect(result.mentions[0]?.resource).toMatchObject({
      projectId: "proj_remote",
    });
  });

  it("keeps a Thread pill if resolution fails", async () => {
    const lookup = vi
      .fn<typeof sdk.threads.resolveMentions>()
      .mockRejectedValue(new Error("offline"));
    const result = await resolveInitialPromptDraft(
      draft("@thread:thr_23456789ab"),
      lookup,
      new AbortController().signal,
    );
    expect(result.mentions[0]?.resource.label).toBe("Thread");
  });

  it.each([false, true])(
    "preserves a non-empty draft when resolution completes (existing: %s)",
    async (existing) => {
      let finish: (
        value: Awaited<ReturnType<typeof sdk.threads.resolveMentions>>,
      ) => void = () => {};
      vi.spyOn(sdk.threads, "resolveMentions").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const scope = {
        kind: "thread" as const,
        projectId: "proj_seed",
        threadId: `thr_seed_${existing}`,
      };
      const { result, rerender } = renderHook(
        ({ seedPrompt }) => {
          const storage = usePromptDraftStorage(scope);
          const seed = useInitialPromptDraft(
            seedPrompt ? "@thread:thr_abcdefghij " : null,
          );
          const restore = storage.restoreIfEmpty;
          useEffect(() => {
            if (seed) restore(seed);
          }, [restore, seed]);
          return { storage, seed };
        },
        { wrapper, initialProps: { seedPrompt: !existing } },
      );
      act(() => {
        result.current.storage.setDraft({
          ...emptyPromptDraftState(),
          text: existing ? "Saved draft" : "Typed during lookup",
        });
      });
      rerender({ seedPrompt: true });
      await act(async () => {
        finish([
          {
            threadId: "thr_abcdefghij",
            projectId: "proj_app",
            label: "Resolved title",
          },
        ]);
      });
      await waitFor(() => expect(result.current.seed).toBeDefined());
      expect(result.current.storage.text).toBe(
        existing ? "Saved draft" : "Typed during lookup",
      );
      expect(result.current.storage.mentions).toEqual([]);
      client.clear();
    },
  );

  it("waits for sidebar metadata and discards a replaced seed's late lookup", async () => {
    navigationState.pending = true;
    let finish: (
      value: Awaited<ReturnType<typeof sdk.threads.resolveMentions>>,
    ) => void = () => {};
    const lookup = vi.spyOn(sdk.threads, "resolveMentions").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ text }) => useInitialPromptDraft(text),
      {
        wrapper,
        initialProps: { text: "@thread:thr_abcdefghij" },
      },
    );
    expect(result.current).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    navigationState.pending = false;
    rerender({ text: "@thread:thr_abcdefghij" });
    await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    rerender({ text: "Replacement seed" });
    await waitFor(() => expect(result.current?.text).toBe("Replacement seed"));
    await act(async () => {
      finish([
        {
          threadId: "thr_abcdefghij",
          projectId: "proj_app",
          label: "Late title",
        },
      ]);
    });
    expect(result.current?.text).toBe("Replacement seed");
    expect(result.current?.mentions).toEqual([]);
    client.clear();
  });

  it("seeds an empty draft with resolved mention ranges", async () => {
    vi.spyOn(sdk.threads, "resolveMentions").mockResolvedValue([
      {
        threadId: "thr_abcdefghij",
        projectId: "proj_app",
        label: "Resolved title",
      },
    ]);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        const storage = usePromptDraftStorage({
          kind: "thread",
          projectId: "proj_seed",
          threadId: "thr_empty",
        });
        const seed = useInitialPromptDraft("@thread:thr_abcdefghij ");
        const restore = storage.restoreIfEmpty;
        useEffect(() => {
          if (seed) restore(seed);
        }, [restore, seed]);
        return storage;
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.mentions).toHaveLength(1));
    expect(result.current.mentions[0]).toMatchObject({
      start: 0,
      end: 22,
      resource: { label: "Resolved title" },
    });
    expect(result.current.text).toBe("@thread:thr_abcdefghij ");
    client.clear();
  });
});
