import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_TITLE_MENTION_RESOURCES,
  resolveSerializedPromptMentions,
  type ThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import type { sdk } from "@/lib/sdk";
import {
  initialPromptDraftQueryOptions,
  resolveInitialPromptDraft,
} from "./initial-prompt-draft";

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

  it("waits for sidebar metadata and discards a replaced seed's late lookup", async () => {
    let finish: (
      value: Awaited<ReturnType<typeof sdk.threads.resolveMentions>>,
    ) => void = () => {};
    const lookup = vi.fn<typeof sdk.threads.resolveMentions>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const options = (text: string, navigationPending: boolean) =>
      initialPromptDraftQueryOptions({
        text,
        navigationPending,
        draft: draft(text, EMPTY_TITLE_MENTION_RESOURCES),
        resolveMentions: lookup,
      });
    const client = new QueryClient();
    const observer = new QueryObserver(
      client,
      options("@thread:thr_abcdefghij", true),
    );
    const unsubscribe = observer.subscribe(() => {});
    await Promise.resolve();
    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    observer.setOptions(options("@thread:thr_abcdefghij", false));
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    observer.setOptions(options("Replacement seed", false));
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.text).toBe("Replacement seed"),
    );
    finish([
      {
        threadId: "thr_abcdefghij",
        projectId: "proj_app",
        label: "Late title",
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observer.getCurrentResult().data?.text).toBe("Replacement seed");
    expect(observer.getCurrentResult().data?.mentions).toEqual([]);
    unsubscribe();
    client.clear();
  });
});
