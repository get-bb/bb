// @vitest-environment jsdom
import { emptyPromptDraftState } from "@bb/client-core";
import {
  buildBridgeInjectionScript,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingPromptDraftPersists,
  getPromptDraftAccessor,
} from "@/hooks/usePromptDraftStorage";
import { resetNativeShellForTests } from "@/lib/native-shell";
import { importSharedContent, isShareId } from "./shared-content-import";

const shareId = "7c5ac65a-1df3-4b9e-9632-e0d04201bf54";
const fileId = "24a317ba-8a2d-4b79-bf79-68bc79376373";
const draft = getPromptDraftAccessor({ kind: "new-thread" });
const handshake: NativeShellHandshake = {
  bridgeVersion: 3,
  appVersion: "1.0.0",
  platform: "ios",
  profileMode: "connect",
  secureContext: true,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  capabilities: [],
};

function installBridge(
  handler: (kind: string, payload: unknown) => unknown | Promise<unknown>,
): void {
  Object.defineProperty(window, "ReactNativeWebView", {
    configurable: true,
    value: {
      postMessage: (raw: string) => {
        const message: unknown = JSON.parse(raw);
        if (
          typeof message !== "object" ||
          message === null ||
          !("type" in message) ||
          message.type !== "request" ||
          !("id" in message) ||
          typeof message.id !== "string" ||
          !("request" in message) ||
          typeof message.request !== "object" ||
          message.request === null ||
          !("kind" in message.request) ||
          typeof message.request.kind !== "string" ||
          !("payload" in message.request)
        )
          return;
        const id = message.id;
        const requestKind = message.request.kind;
        const payload = message.request.payload;
        const bridgeWindow = window as typeof window & {
          bb: { native: { __receive: (event: unknown) => void } };
        };
        void Promise.resolve()
          .then(() => handler(requestKind, payload))
          .then(
            (result) =>
              bridgeWindow.bb.native.__receive({
                type: "response",
                id,
                response: { ok: true, result },
              }),
            (error: unknown) =>
              bridgeWindow.bb.native.__receive({
                type: "response",
                id,
                response: {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              }),
          );
      },
    },
  });
  new Function("window", buildBridgeInjectionScript(handshake))(window);
  resetNativeShellForTests();
}

function sharedContent() {
  return {
    claimScopeKey: "3b39de05-7635-45d5-bda2-88cd80917c89",
    shareId,
    text: "Shared note",
    files: [
      {
        fileId,
        fileName: "photo.jpg",
        kind: "image",
        mimeType: "image/jpeg",
        sizeBytes: 12,
        processingError: "A prior conversion attempt failed.",
      },
    ],
  };
}

function resetDraft(): void {
  draft.setDraft({
    ...emptyPromptDraftState(),
    text: "Keep my existing prompt",
    attachments: [
      {
        type: "localFile",
        path: "existing.txt",
        name: "existing.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
      },
    ],
  });
  flushPendingPromptDraftPersists();
}

beforeEach(() => {
  window.localStorage.clear();
  resetDraft();
  resetNativeShellForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "bb");
  Reflect.deleteProperty(window, "ReactNativeWebView");
  resetNativeShellForTests();
});

describe("shared content import", () => {
  it("accepts only UUID route values", () => {
    expect(isShareId(shareId)).toBe(true);
    expect(isShareId("share/../id")).toBe(false);
  });

  it("preserves existing draft content and retries acknowledgement without duplicate import", async () => {
    let acknowledgementCount = 0;
    let uploadCount = 0;
    let acknowledgementWasApplied = false;
    installBridge((kind) => {
      if (kind === "get-shared-content")
        return acknowledgementWasApplied
          ? {
              claimScopeKey: "3b39de05-7635-45d5-bda2-88cd80917c89",
              shareId,
              text: "",
              files: [],
              alreadyAcknowledged: true,
            }
          : sharedContent();
      if (kind === "start-shared-upload") {
        uploadCount += 1;
        return { jobId: "job-1" };
      }
      if (kind === "shared-upload-status")
        return {
          jobId: "job-1",
          status: "complete",
          attachment: {
            type: "localImage",
            path: "uploaded/photo.jpg",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 12,
            sourceProjectId: "project-1",
          },
        };
      acknowledgementCount += 1;
      acknowledgementWasApplied = true;
      throw new Error("temporary acknowledgement failure");
    });
    const run = () =>
      importSharedContent({
        shareId,
        projectId: "project-1",
        draft,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });

    await expect(run()).rejects.toThrow("temporary acknowledgement failure");
    await run();

    expect(draft.getCurrent().text).toBe(
      "Keep my existing prompt\n\nShared note",
    );
    expect(draft.getCurrent().attachments.map(({ path }) => path)).toEqual([
      "existing.txt",
      "uploaded/photo.jpg",
    ]);
    expect(uploadCount).toBe(1);
    expect(acknowledgementCount).toBe(1);
  });

  it("keeps the share unacknowledged when draft persistence fails", async () => {
    let acknowledged = false;
    installBridge((kind) => {
      if (kind === "get-shared-content")
        return { ...sharedContent(), files: [] };
      acknowledged = true;
      return { acknowledged: true };
    });
    const originalSetItem = Storage.prototype.setItem;
    const setItemMock = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key.startsWith("bb.promptbox.contents"))
          throw new Error("storage full");
        return originalSetItem.call(this, key, value);
      });

    const run = () =>
      importSharedContent({
        shareId,
        projectId: "project-1",
        draft,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
    await expect(run()).rejects.toThrow("Draft storage is unavailable");
    await expect(run()).rejects.toThrow("Draft storage is unavailable");
    expect(acknowledged).toBe(false);
    setItemMock.mockRestore();
    await run();
    expect(acknowledged).toBe(true);
    expect(draft.getCurrent().text).toBe(
      "Keep my existing prompt\n\nShared note",
    );
  });

  it("does not attach a stale result after the project scope is aborted", async () => {
    let resolveStatus: ((result: unknown) => void) | undefined;
    installBridge((kind) => {
      if (kind === "get-shared-content") return sharedContent();
      if (kind === "start-shared-upload") return { jobId: "job-1" };
      if (kind === "shared-upload-status")
        return new Promise((resolve) => {
          resolveStatus = resolve;
        });
      return { acknowledged: true };
    });
    const controller = new AbortController();
    const imported = importSharedContent({
      shareId,
      projectId: "project-1",
      draft,
      signal: controller.signal,
      onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(resolveStatus).toBeTypeOf("function"));
    controller.abort();
    resolveStatus?.({
      jobId: "job-1",
      status: "complete",
      attachment: {
        type: "localImage",
        path: "stale/photo.jpg",
        name: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 12,
        sourceProjectId: "project-1",
      },
    });

    await expect(imported).rejects.toMatchObject({ name: "AbortError" });
    expect(draft.getCurrent().attachments.map(({ path }) => path)).toEqual([
      "existing.txt",
    ]);
  });

  it("imports shared content into the selected thread draft without changing the new-thread draft", async () => {
    const threadDraft = getPromptDraftAccessor({
      kind: "thread",
      projectId: "project-1",
      threadId: "thread-1",
    });
    threadDraft.setDraft({
      ...emptyPromptDraftState(),
      text: "Existing thread draft",
      attachments: [
        {
          type: "localImage",
          path: "existing-thread.png",
          name: "existing-thread.png",
          mimeType: "image/png",
          sizeBytes: 8,
        },
      ],
    });
    flushPendingPromptDraftPersists();
    installBridge((kind) => {
      if (kind === "get-shared-content") return sharedContent();
      if (kind === "start-shared-upload") return { jobId: "thread-job" };
      if (kind === "shared-upload-status")
        return {
          jobId: "thread-job",
          status: "complete",
          attachment: {
            type: "localImage",
            path: "uploaded/thread-photo.jpg",
            name: "photo.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 12,
            sourceProjectId: "project-1",
          },
        };
      return { acknowledged: true };
    });

    await importSharedContent({
      shareId,
      projectId: "project-1",
      draft: threadDraft,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(threadDraft.getCurrent().text).toBe(
      "Existing thread draft\n\nShared note",
    );
    expect(
      threadDraft.getCurrent().attachments.map(({ path }) => path),
    ).toEqual(["existing-thread.png", "uploaded/thread-photo.jpg"]);
    expect(draft.getCurrent().attachments.map(({ path }) => path)).toEqual([
      "existing.txt",
    ]);
    expect(draft.getCurrent().text).toBe("Keep my existing prompt");
    expect(threadDraft.storageKey).not.toBe(draft.storageKey);
  });
});
