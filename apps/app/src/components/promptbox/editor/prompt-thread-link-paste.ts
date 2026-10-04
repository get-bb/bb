import { isProjectlessProjectId } from "@bb/client-core";
import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ResolveThreadMentionsResponse,
} from "@bb/server-contract";
import { Extension, getChangedRanges, type Editor } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";
import {
  findPastedThreadLinkCandidates,
  type PastedThreadLink,
} from "../mentions/pasted-thread-link-candidates";
import { promptEditorSerializationFromDoc } from "./prompt-editor-serialization";

type ThreadMentionResolution = ResolveThreadMentionsResponse[number];

interface PromptThreadLinkPasteOptions {
  getOrigin: () => string;
  getCachedThread: (threadId: string) => ThreadMentionResolution | null;
  resolveThreads: (
    threadIds: string[],
    signal: AbortSignal,
  ) => Promise<readonly ThreadMentionResolution[]>;
}

interface PendingPaste {
  occurrences: PastedThreadLink[];
  controller: AbortController;
}

interface PasteMetadata {
  skip?: boolean;
  cancel?: boolean;
  converted?: boolean;
  literalLinkIndexes?: number[];
}

export const promptThreadLinkPasteKey = new PluginKey("promptThreadLinkPaste");

function pasteMetadata(transaction: Transaction): PasteMetadata {
  return transaction.getMeta(promptThreadLinkPasteKey) ?? {};
}

export function cancelPromptThreadLinkPaste(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(promptThreadLinkPasteKey, { cancel: true }),
  );
}

function isConvertibleText(
  doc: ProseMirrorNode,
  occurrence: PastedThreadLink,
): boolean {
  if (doc.textBetween(occurrence.from, occurrence.to) !== occurrence.text) {
    return false;
  }
  let convertible = true;
  doc.nodesBetween(occurrence.from, occurrence.to, (node) => {
    if (
      node.type.name === "mention" ||
      node.type.name === "blockquote" ||
      node.type.spec.code ||
      node.marks.some(
        (mark) => mark.type.spec.code || mark.type.name === "link",
      )
    ) {
      convertible = false;
      return false;
    }
    return convertible;
  });
  return convertible;
}

function documentLinks(
  doc: ProseMirrorNode,
  origin: string,
  findLinks = findPastedThreadLinkCandidates,
): PastedThreadLink[] {
  const { text, offsetMapping } = promptEditorSerializationFromDoc(doc);
  return findLinks({ text, origin }).flatMap((link) => {
    const first = offsetMapping.find(
      (segment) =>
        segment.kind === "text" &&
        segment.textFrom <= link.from &&
        segment.textTo > link.from,
    );
    const last = offsetMapping.find(
      (segment) =>
        segment.kind === "text" &&
        segment.textFrom < link.to &&
        segment.textTo >= link.to,
    );
    if (!first || !last) return [];
    const occurrence = {
      ...link,
      from: first.docFrom + link.from - first.textFrom,
      to: last.docFrom + link.to - last.textFrom,
    };
    return occurrence.to - occurrence.from === link.text.length
      ? [occurrence]
      : [];
  });
}

function pastedOccurrences(
  transaction: Transaction,
  origin: string,
  literalLinkIndexes: number[],
): PastedThreadLink[] {
  const inserted = getChangedRanges(transaction).map(
    ({ newRange }) => newRange,
  );
  return documentLinks(transaction.doc, origin)
    .filter((link) =>
      inserted.some((range) => link.from >= range.from && link.to <= range.to),
    )
    .filter(
      (link, index) =>
        !literalLinkIndexes.includes(index) &&
        isConvertibleText(transaction.doc, link),
    );
}

function eligibleOccurrences(
  doc: ProseMirrorNode,
  paste: PendingPaste,
  origin: string,
  findLinks: typeof findPastedThreadLinkCandidates,
): PastedThreadLink[] {
  return documentLinks(doc, origin, findLinks).filter((link) =>
    paste.occurrences.some(
      (occurrence) =>
        link.from === occurrence.from &&
        link.to === occurrence.to &&
        link.text === occurrence.text,
    ),
  );
}

function mapOccurrence(
  occurrence: PastedThreadLink,
  transaction: Transaction,
): PastedThreadLink | null {
  let { from, to } = occurrence;
  for (const [index, map] of transaction.mapping.maps.entries()) {
    let changed = false;
    const step = transaction.steps[index];
    if (
      (step instanceof AddMarkStep || step instanceof RemoveMarkStep) &&
      step.from < to &&
      step.to > from
    ) {
      return null;
    }
    map.forEach((start, end) => {
      if (
        start === end ? start > from && start < to : start < to && end > from
      ) {
        changed = true;
      }
    });
    if (changed) return null;
    from = map.map(from, 1);
    to = map.map(to, -1);
  }
  return from < to ? { ...occurrence, from, to } : null;
}

export function createPromptThreadLinkPasteExtension(
  options: PromptThreadLinkPasteOptions,
) {
  const pending = new Set<PendingPaste>();
  const cancel = (paste: PendingPaste) => {
    pending.delete(paste);
    paste.controller.abort();
  };

  const resolve = async (editor: Editor, paste: PendingPaste) => {
    const { signal } = paste.controller;
    const resolved = new Map<string, ThreadMentionResolution>();
    let findLinks: typeof findPastedThreadLinkCandidates | undefined;
    const finish = () => {
      if (!pending.has(paste)) return;
      cancel(paste);
      if (editor.isDestroyed || !findLinks) return;
      const eligible = eligibleOccurrences(
        editor.state.doc,
        paste,
        options.getOrigin(),
        findLinks,
      );
      const transaction = editor.state.tr;
      for (const occurrence of eligible.reverse()) {
        const thread = resolved.get(occurrence.threadId);
        if (
          !thread ||
          (occurrence.projectId === null
            ? !isProjectlessProjectId(thread.projectId)
            : occurrence.projectId !== thread.projectId) ||
          !isConvertibleText(transaction.doc, occurrence)
        )
          continue;
        transaction.replaceWith(
          occurrence.from,
          occurrence.to,
          editor.schema.nodes.mention!.create(
            {
              resource: {
                kind: "thread",
                ...thread,
                label: thread.label.trim() || thread.threadId,
              },
              serializedText: `@thread:${thread.threadId}`,
            },
            null,
            transaction.doc.nodeAt(occurrence.from)?.marks,
          ),
        );
      }
      if (transaction.docChanged) {
        editor.view.dispatch(
          closeHistory(transaction).setMeta(promptThreadLinkPasteKey, {
            converted: true,
          }),
        );
      }
    };
    const timeout = setTimeout(finish, 2_000);
    signal.addEventListener("abort", () => clearTimeout(timeout), {
      once: true,
    });
    try {
      findLinks = (await import("../mentions/pasted-thread-links"))
        .findPastedThreadLinks;
      if (signal.aborted) return;
      const missing: string[] = [];
      for (const id of new Set(
        eligibleOccurrences(
          editor.state.doc,
          paste,
          options.getOrigin(),
          findLinks,
        ).map((link) => link.threadId),
      )) {
        const cached = options.getCachedThread(id);
        if (cached?.threadId === id) resolved.set(id, cached);
        else missing.push(id);
      }
      const batches: Promise<void>[] = [];
      for (
        let index = 0;
        index < missing.length;
        index += THREAD_MENTION_RESOLVE_MAX_IDS
      ) {
        const ids = missing.slice(
          index,
          index + THREAD_MENTION_RESOLVE_MAX_IDS,
        );
        batches.push(
          (async () => {
            const threads = await options.resolveThreads(ids, signal);
            if (signal.aborted) return;
            for (const thread of threads) {
              if (ids.includes(thread.threadId))
                resolved.set(thread.threadId, thread);
            }
          })(),
        );
      }
      await Promise.allSettled(batches);
    } catch {
      return;
    } finally {
      finish();
    }
  };

  return Extension.create({
    name: "promptThreadLinkPaste",
    priority: 50,
    onTransaction({ editor, transaction, appendedTransactions }) {
      const added: PendingPaste[] = [];
      for (const current of [transaction, ...appendedTransactions]) {
        const metadata = pasteMetadata(current);
        for (const paste of pending) {
          paste.occurrences =
            metadata.cancel || isHistoryTransaction(current)
              ? []
              : paste.occurrences.flatMap((occurrence) => {
                  const mapped = mapOccurrence(occurrence, current);
                  return mapped ? [mapped] : [];
                });
          if (paste.occurrences.length === 0) cancel(paste);
        }
        if (
          current.docChanged &&
          current.getMeta("uiEvent") === "paste" &&
          !metadata.skip
        ) {
          const occurrences = pastedOccurrences(
            current,
            options.getOrigin(),
            metadata.literalLinkIndexes ?? [],
          );
          if (occurrences.length === 0) continue;
          const paste = { occurrences, controller: new AbortController() };
          pending.add(paste);
          added.push(paste);
        }
      }
      for (const paste of added) {
        if (pending.has(paste)) void resolve(editor, paste);
      }
    },
    onDestroy() {
      for (const paste of pending) cancel(paste);
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: promptThreadLinkPasteKey,
          filterTransaction(transaction) {
            if (
              transaction.docChanged &&
              transaction.getMeta("uiEvent") === "paste" &&
              !pasteMetadata(transaction).skip
            )
              closeHistory(transaction);
            return true;
          },
          appendTransaction(transactions, _oldState, newState) {
            return transactions.some((transaction) => {
              const metadata = pasteMetadata(transaction);
              return (
                transaction.docChanged &&
                !isHistoryTransaction(transaction) &&
                ((transaction.getMeta("uiEvent") === "paste" &&
                  !metadata.skip) ||
                  metadata.converted)
              );
            })
              ? closeHistory(newState.tr).setMeta("addToHistory", false)
              : null;
          },
        }),
      ];
    },
  });
}
