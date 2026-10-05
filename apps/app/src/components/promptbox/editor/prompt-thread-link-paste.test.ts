// @vitest-environment jsdom

import { GENERATED_ID_ALPHABET, PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ResolveThreadMentionsResponse } from "@bb/server-contract";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptEditorExtensions } from "./prompt-editor-extensions";
import {
  promptEditorContentFromValue,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
} from "./prompt-editor-serialization";
import {
  cancelPromptThreadLinkPaste,
  createPromptThreadLinkPasteExtension,
  promptThreadLinkPasteKey,
} from "./prompt-thread-link-paste";

const origin = "https://brsbl.getbb.app";
const projectId = "proj_khiw2za95v";
const threadId = "thr_86mb5jjzi9";
const secondId = "thr_2222222222";
const url = `${origin}/projects/${projectId}/threads/${threadId}`;
const secondUrl = `${origin}/projects/${projectId}/threads/${secondId}`;
const editors: Editor[] = [];

type Resolution = ResolveThreadMentionsResponse[number];
type PasteOptions = Parameters<typeof createPromptThreadLinkPasteExtension>[0];

function resolution(id = threadId, project = projectId): Resolution {
  return { threadId: id, projectId: project, label: `Thread ${id}` };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createEditor({
  text = "",
  getCachedThread = () => null,
  resolveThreads = async () => [],
}: Partial<PasteOptions> & { text?: string } = {}) {
  const editor = new Editor({
    extensions: [
      ...promptEditorExtensions({ getPlaceholder: () => "" }),
      createPromptThreadLinkPasteExtension({
        getOrigin: () => origin,
        getCachedThread,
        resolveThreads,
      }),
    ],
    content: promptEditorContentFromValue({ text, mentions: [] }),
  });
  editors.push(editor);
  return editor;
}

async function paste(editor: Editor, text: string, skip = false) {
  editor
    .chain()
    .insertContent(promptEditorInlineContentFromValue({ text, mentions: [] }))
    .setMeta("uiEvent", "paste")
    .setMeta(promptThreadLinkPasteKey, { skip })
    .run();
  await vi.dynamicImportSettled();
  await vi.advanceTimersByTimeAsync(0);
}

function value(editor: Editor) {
  return promptEditorValueFromDoc(editor.state.doc);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
  vi.useRealTimers();
});

describe("pasted thread link conversion", () => {
  it.each([
    ["fragment", "", "#message"],
    ["query", "", "?view=x"],
    ["path", "", "/messages"],
    ["inline code", "`", "`"],
    ["authored link", "[", "](https://example.com)"],
  ])(
    "preserves a pending URL after surrounding edits create %s",
    async (_name, prefix, suffix) => {
      const pending = deferred<Resolution[]>();
      const editor = createEditor({ resolveThreads: () => pending.promise });
      await paste(editor, url);
      editor.view.dispatch(editor.state.tr.insertText(suffix, 1 + url.length));
      if (prefix) editor.view.dispatch(editor.state.tr.insertText(prefix, 1));
      pending.resolve([resolution()]);
      await vi.advanceTimersByTimeAsync(0);
      expect(value(editor)).toEqual({
        text: `${prefix}${url}${suffix}`,
        mentions: [],
      });
    },
  );
  it("converts one paste atomically and replays exact URL and selection history", async () => {
    const pending = deferred<Resolution[]>();
    const resolveThreads = vi.fn(
      (_ids: string[], _signal: AbortSignal) => pending.promise,
    );
    const original = "Before selected after";
    const editor = createEditor({
      text: original,
      getCachedThread: (id) => (id === threadId ? resolution(id) : null),
      resolveThreads,
    });
    editor.commands.setTextSelection({ from: 8, to: 16 });
    const pasted = `😀 (${url}/), ${secondUrl} and ${url}. https://example.com`;
    await paste(editor, pasted);
    expect(value(editor)).toEqual({
      text: `Before ${pasted} after`,
      mentions: [],
    });
    expect(resolveThreads.mock.calls[0]?.[0]).toEqual([secondId]);

    pending.resolve([resolution(secondId)]);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    const converted = value(editor);
    expect(converted.text).toBe(
      `Before 😀 (@thread:${threadId}), @thread:${secondId} and @thread:${threadId}. https://example.com after`,
    );
    expect(converted.mentions.map((mention) => mention.resource)).toEqual([
      { kind: "thread", ...resolution() },
      { kind: "thread", ...resolution(secondId) },
      { kind: "thread", ...resolution() },
    ]);
    editor.commands.undo();
    expect(value(editor)).toEqual({
      text: `Before ${pasted} after`,
      mentions: [],
    });
    editor.commands.undo();
    expect(value(editor)).toEqual({ text: original, mentions: [] });
    expect(editor.state.selection.from).toBe(8);
    expect(editor.state.selection.to).toBe(16);
    editor.commands.redo();
    expect(value(editor).text).toBe(`Before ${pasted} after`);
    editor.commands.redo();
    expect(value(editor)).toEqual(converted);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveThreads).toHaveBeenCalledTimes(1);

    editor.commands.insertContent(" typed");
    editor.commands.undo();
    expect(value(editor)).toEqual(converted);
    editor.commands.undo();
    expect(value(editor)).toEqual({
      text: `Before ${pasted} after`,
      mentions: [],
    });
  });

  it("maps boundary edits and the current caret while permanently excluding edited or removed occurrences", async () => {
    const pending = deferred<Resolution[]>();
    const resolveThreads = vi.fn(
      (_ids: string[], _signal: AbortSignal) => pending.promise,
    );
    const editor = createEditor({ resolveThreads });
    await paste(editor, `${url} and ${url} then ${url}`);
    editor.view.dispatch(editor.state.tr.insertText("📎 ", 1));
    editor.view.dispatch(editor.state.tr.insertText("!", 1 + 3 + url.length));

    const secondStart = editor.state.doc.textContent.indexOf(url, 4) + 1;
    const changedAt = secondStart + 10;
    const original = editor.state.doc.textBetween(changedAt, changedAt + 1);
    editor.view.dispatch(
      editor.state.tr.insertText("X", changedAt, changedAt + 1),
    );
    editor.view.dispatch(
      editor.state.tr.insertText(original, changedAt, changedAt + 1),
    );
    const thirdStart = editor.state.doc.textContent.lastIndexOf(url) + 1;
    editor.view.dispatch(
      editor.state.tr.delete(thirdStart, thirdStart + url.length),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    pending.resolve([resolution()]);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(value(editor).text).toBe(`📎 @thread:${threadId}! and ${url} then `);
    expect(value(editor).mentions).toHaveLength(1);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
    expect(resolveThreads.mock.calls[0]?.[0]).toEqual([threadId]);
  });

  it.each(["undo", "cancel", "destroy"])(
    "aborts pending lookup on %s and ignores its late result",
    async (action) => {
      const pending = deferred<Resolution[]>();
      const resolveThreads = vi.fn(
        (_ids: string[], _signal: AbortSignal) => pending.promise,
      );
      const editor = createEditor({ resolveThreads });
      await paste(editor, url);
      const signal = resolveThreads.mock.calls[0]![1];
      if (action === "undo") editor.commands.undo();
      if (action === "cancel") {
        cancelPromptThreadLinkPaste(editor);
        editor.commands.setContent(
          promptEditorContentFromValue({ text: url, mentions: [] }),
        );
      }
      if (action === "destroy") editor.destroy();
      const updates = vi.fn();
      editor.on("update", updates);
      expect(signal.aborted).toBe(true);

      pending.resolve([resolution()]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(updates).not.toHaveBeenCalled();
      if (action !== "destroy") {
        expect(value(editor)).toEqual({
          text: action === "undo" ? "" : url,
          mentions: [],
        });
      }
    },
  );

  it("commits cached and successful batches once at the deadline without waiting for a stalled batch", async () => {
    const ids = Array.from({ length: 34 }, (_, index) => {
      const high =
        GENERATED_ID_ALPHABET[Math.floor(index / GENERATED_ID_ALPHABET.length)];
      const low = GENERATED_ID_ALPHABET[index % GENERATED_ID_ALPHABET.length];
      return `thr_22222222${high}${low}`;
    });
    const stalled = deferred<Resolution[]>();
    const resolveThreads = vi.fn((batch: string[], _signal: AbortSignal) =>
      batch.length === 32
        ? Promise.resolve(batch.map((id) => resolution(id)))
        : stalled.promise,
    );
    const editor = createEditor({
      getCachedThread: (id) => (id === ids[0] ? resolution(id) : null),
      resolveThreads,
    });
    const pasted = ids
      .map((id) => `${origin}/projects/${projectId}/threads/${id}`)
      .join(" ");
    await paste(editor, pasted);
    expect(resolveThreads.mock.calls.map(([batch]) => batch.length)).toEqual([
      32, 1,
    ]);
    expect(value(editor).mentions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(value(editor).mentions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const converted = value(editor);
    expect(converted.mentions).toHaveLength(33);
    expect(converted.text.endsWith(`/threads/${ids[33]}`)).toBe(true);
    expect(
      resolveThreads.mock.calls.every(([, signal]) => signal.aborted),
    ).toBe(true);

    stalled.resolve([resolution(ids[33]!)]);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(value(editor)).toEqual(converted);
    editor.commands.undo();
    expect(value(editor)).toEqual({ text: pasted, mentions: [] });
  });

  it("requires a matching project and verifies projectless routes without converting missing targets", async () => {
    const personalId = "thr_3333333333";
    const wrongProjectlessId = "thr_4444444444";
    const absentId = "thr_5555555555";
    const mismatched = url;
    const personal = `${origin}/threads/${personalId}`;
    const wrongProjectless = `${origin}/threads/${wrongProjectlessId}`;
    const missing = `${origin}/projects/${projectId}/threads/${absentId}`;
    const editor = createEditor({
      resolveThreads: async () => [
        resolution(threadId, "proj_2222222222"),
        { ...resolution(personalId, PERSONAL_PROJECT_ID), label: " " },
        resolution(wrongProjectlessId),
      ],
    });
    await paste(
      editor,
      [mismatched, personal, wrongProjectless, missing].join(" "),
    );
    expect(value(editor)).toEqual({
      text: `${mismatched} @thread:${personalId} ${wrongProjectless} ${missing}`,
      mentions: [
        {
          start: mismatched.length + 1,
          end: mismatched.length + 1 + `@thread:${personalId}`.length,
          resource: {
            kind: "thread",
            threadId: personalId,
            projectId: PERSONAL_PROJECT_ID,
            label: personalId,
          },
        },
      ],
    });
  });

  it("leaves failed lookups sendable without retrying", async () => {
    const resolveThreads = vi.fn(async () => {
      throw new Error("offline");
    });
    const editor = createEditor({ resolveThreads });
    await paste(editor, url);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(value(editor)).toEqual({ text: url, mentions: [] });
    editor.commands.insertContent(" later");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(value(editor)).toEqual({ text: `${url} later`, mentions: [] });
    expect(resolveThreads).toHaveBeenCalledTimes(1);
  });

  it("only converts newly pasted text and honors explicit plain-text paste", async () => {
    const resolveThreads = vi.fn(async () => [resolution()]);
    const editor = createEditor({ text: url, resolveThreads });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    await paste(editor, " copied ");
    await paste(editor, url, true);
    editor.commands.insertContent(` programmatic ${url}`);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(value(editor)).toEqual({
      text: `${url} copied ${url} programmatic ${url}`,
      mentions: [],
    });
    expect(resolveThreads).not.toHaveBeenCalled();

    await paste(editor, ` fresh ${url}`);
    expect(value(editor).text).toBe(
      `${url} copied ${url} programmatic ${url} fresh @thread:${threadId}`,
    );
    expect(value(editor).mentions).toHaveLength(1);
  });

  it("preserves pasted mention atoms and maps a following URL to its document position", async () => {
    const resolveThreads = vi.fn(async (_ids: string[]) => [resolution()]);
    const editor = createEditor({ resolveThreads });
    const copiedToken = `@thread:${secondId}`;
    editor
      .chain()
      .insertContent(
        promptEditorInlineContentFromValue({
          text: `${copiedToken} ${url}`,
          mentions: [
            {
              start: 0,
              end: copiedToken.length,
              resource: { kind: "thread", ...resolution(secondId) },
            },
          ],
        }),
      )
      .setMeta("uiEvent", "paste")
      .run();
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(value(editor).text).toBe(`${copiedToken} @thread:${threadId}`);
    expect(value(editor).mentions.map((mention) => mention.resource)).toEqual([
      { kind: "thread", ...resolution(secondId) },
      { kind: "thread", ...resolution() },
    ]);
    expect(resolveThreads.mock.calls[0]?.[0]).toEqual([threadId]);
  });

  it("leaves a URL literal when pasted into an existing blockquote", async () => {
    const resolveThreads = vi.fn(async () => [resolution()]);
    const editor = createEditor({ resolveThreads });
    editor.commands.setBlockquote();
    await paste(editor, url);
    expect(value(editor).mentions).toHaveLength(0);
    expect(value(editor).text).toContain(url);
    expect(resolveThreads).not.toHaveBeenCalled();
  });
});
