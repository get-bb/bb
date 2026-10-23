import {
  sharedContentResponseSchema,
  sharedUploadStatusSchema,
} from "@bb/mobile-bridge";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import { promptTextMentionSchema } from "@bb/domain";
import type { PromptDraftController } from "@/hooks/usePromptDraftStorage";
import { flushPendingPromptDraftPersists } from "@/hooks/usePromptDraftStorage";
import { getNativeShell } from "@/lib/native-shell";

const RECEIPT_PREFIX = "bb.shared-import.receipt.v1";
const POLL_INTERVAL_MS = 1000;

export function isShareId(value: string | null): value is string {
  return (
    value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function createSharedImportReceiptKey(args: {
  shareId: string;
  projectId: string;
  profileScope: string;
  draftStorageKey: string;
}): string {
  return `${RECEIPT_PREFIX}:${encodeURIComponent(args.profileScope)}:${args.shareId}:${encodeURIComponent(args.projectId)}:${encodeURIComponent(args.draftStorageKey)}`;
}

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, POLL_INTERVAL_MS);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function reportProgress(
  signal: AbortSignal,
  onProgress: (message: string) => void,
  message: string,
): void {
  throwIfAborted(signal);
  onProgress(message);
}

export async function importSharedContent(args: {
  shareId: string;
  projectId: string;
  draft: PromptDraftController;
  signal: AbortSignal;
  onProgress: (message: string) => void;
}): Promise<void> {
  const shell = getNativeShell();
  if (!shell || shell.handshake.bridgeVersion < 3)
    throw new Error("Update the BB mobile app to import this share.");
  const request = shell.request.bind(shell);
  const content = sharedContentResponseSchema.parse(
    await request("get-shared-content", {
      shareId: args.shareId,
      projectId: args.projectId,
    }),
  );
  throwIfAborted(args.signal);
  if (content.shareId !== args.shareId)
    throw new Error("The shared item did not match this import.");
  const receiptKey = createSharedImportReceiptKey({
    shareId: args.shareId,
    projectId: args.projectId,
    profileScope: content.claimScopeKey,
    draftStorageKey: args.draft.storageKey,
  });
  const storage = window.localStorage;
  const rawReceipt = storage.getItem(receiptKey);
  let receipt: {
    textImported: boolean;
    fileIds: string[];
    complete?: boolean;
  } = {
    textImported: false,
    fileIds: [],
  };
  if (rawReceipt) {
    try {
      const parsed: unknown = JSON.parse(rawReceipt);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "textImported" in parsed &&
        parsed.textImported === true &&
        "fileIds" in parsed &&
        Array.isArray(parsed.fileIds) &&
        parsed.fileIds.every((fileId) => typeof fileId === "string") &&
        (!("complete" in parsed) || typeof parsed.complete === "boolean")
      )
        receipt = {
          textImported: true,
          fileIds: parsed.fileIds,
          ...("complete" in parsed && parsed.complete === true
            ? { complete: true }
            : {}),
        };
    } catch {
      storage.removeItem(receiptKey);
    }
  }
  if (content.alreadyAcknowledged) {
    if (!receipt.complete)
      throw new Error(
        "The phone already removed this share, but this draft has no complete import receipt. Restore the saved draft before continuing.",
      );
    try {
      storage.removeItem(receiptKey);
      storage.removeItem(`${receiptKey}:pending-text`);
    } catch {
      return;
    }
    return;
  }
  throwIfAborted(args.signal);
  const draft = args.draft.getCurrent();
  {
    if (!receipt.textImported) {
      const afterText = draft.text.trim()
        ? `${draft.text}\n\n${content.text}`
        : content.text;
      const pendingTextKey = `${receiptKey}:pending-text`;
      const pendingTextRaw = storage.getItem(pendingTextKey);
      let beforeText = draft.text;
      let targetText = afterText;
      let mentions = draft.mentions;
      if (pendingTextRaw) {
        const pending: unknown = JSON.parse(pendingTextRaw);
        if (
          typeof pending !== "object" ||
          pending === null ||
          !("beforeText" in pending) ||
          typeof pending.beforeText !== "string" ||
          !("afterText" in pending) ||
          typeof pending.afterText !== "string" ||
          !("mentions" in pending)
        )
          throw new Error(
            "The shared text import journal is invalid. Keep the share and retry after recovering the draft.",
          );
        const pendingMentions = promptTextMentionSchema
          .array()
          .safeParse(pending.mentions);
        if (!pendingMentions.success)
          throw new Error(
            "The shared text import journal is invalid. Keep the share and retry after recovering the draft.",
          );
        beforeText = pending.beforeText;
        targetText = pending.afterText;
        mentions = pendingMentions.data;
        if (draft.text !== beforeText && draft.text !== targetText)
          throw new Error(
            "Your draft changed during share import. Copy the shared text before retrying.",
          );
      } else {
        storage.setItem(
          pendingTextKey,
          JSON.stringify({ beforeText, afterText, mentions }),
        );
      }
      if (content.text.trim() && draft.text === beforeText) {
        args.draft.setTextAndMentions(targetText, mentions);
      }
      if (!flushPendingPromptDraftPersists())
        throw new Error(
          "Draft storage is unavailable. Free space or enable browser storage, then retry; the share is still saved on your phone.",
        );
      receipt.textImported = true;
      storage.setItem(receiptKey, JSON.stringify(receipt));
      storage.removeItem(pendingTextKey);
    }
    for (const file of content.files) {
      throwIfAborted(args.signal);
      if (receipt.fileIds.includes(file.fileId)) continue;
      reportProgress(
        args.signal,
        args.onProgress,
        `Uploading ${file.fileName}…`,
      );
      const started = await request("start-shared-upload", {
        shareId: args.shareId,
        fileId: file.fileId,
        projectId: args.projectId,
      });
      throwIfAborted(args.signal);
      if (
        typeof started !== "object" ||
        started === null ||
        !("jobId" in started) ||
        typeof started.jobId !== "string"
      )
        throw new Error("The mobile app returned an invalid upload job.");
      for (;;) {
        throwIfAborted(args.signal);
        const status = sharedUploadStatusSchema.parse(
          await request("shared-upload-status", { jobId: started.jobId }),
        );
        throwIfAborted(args.signal);
        if (status.jobId !== started.jobId)
          throw new Error("The mobile app returned a different upload job.");
        if (status.status === "failed")
          throw new Error(
            status.error ?? `Upload failed for ${file.fileName}.`,
          );
        if (status.status === "complete") {
          const attachment = uploadedPromptAttachmentSchema.parse(
            status.attachment,
          );
          if (
            attachment.sourceProjectId &&
            attachment.sourceProjectId !== args.projectId
          )
            throw new Error(
              "The uploaded attachment belongs to a different project.",
            );
          args.draft.addAttachment(attachment);
          if (!flushPendingPromptDraftPersists())
            throw new Error(
              "Draft storage is unavailable. Free space or enable browser storage, then retry; the share is still saved on your phone.",
            );
          receipt.fileIds.push(file.fileId);
          storage.setItem(receiptKey, JSON.stringify(receipt));
          break;
        }
        await delay(args.signal);
      }
    }
    throwIfAborted(args.signal);
  }
  if (!flushPendingPromptDraftPersists())
    throw new Error(
      "Draft storage is unavailable. Free space or enable browser storage, then retry; the share is still saved on your phone.",
    );
  receipt.textImported = true;
  receipt.fileIds = content.files.map((file) => file.fileId);
  receipt.complete = true;
  storage.setItem(receiptKey, JSON.stringify(receipt));
  reportProgress(args.signal, args.onProgress, "Finishing import…");
  const ack = await request("acknowledge-share", {
    shareId: args.shareId,
    projectId: args.projectId,
  });
  throwIfAborted(args.signal);
  if (
    typeof ack !== "object" ||
    ack === null ||
    !("acknowledged" in ack) ||
    ack.acknowledged !== true
  )
    throw new Error(
      "The mobile app could not confirm the import. Retry to finish safely.",
    );
  try {
    storage.removeItem(receiptKey);
    storage.removeItem(`${receiptKey}:pending-text`);
  } catch {
    return;
  }
}
