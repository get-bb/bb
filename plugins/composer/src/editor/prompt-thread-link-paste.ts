import type { ExperimentalComposerThreadLink } from "@get-bb/plugin-sdk/app";
import { Extension, getChangedRanges, type Editor } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import {
  findPastedThreadLinkCandidates,
  type PastedThreadLink,
  type ThreadLinkParser,
} from "../mentions/pasted-thread-link-candidates";
import { promptEditorSerializationFromDoc } from "./prompt-editor-serialization";

interface PromptThreadLinkPasteOptions {
  parseLink: ThreadLinkParser;
  getCachedThread: (threadId: string) => ExperimentalComposerThreadLink | null;
  resolveThreads: (
    threadIds: readonly string[],
    signal: AbortSignal,
    onBatch: (threads: readonly ExperimentalComposerThreadLink[]) => void,
  ) => Promise<void>;
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
    if (node.type.name === "mention" || node.type.name === "blockquote") {
      convertible = false;
      return false;
    }
    return convertible;
  });
  return convertible;
}

function documentLinks(
  doc: ProseMirrorNode,
  parseLink: ThreadLinkParser,
  findLinks = findPastedThreadLinkCandidates,
): PastedThreadLink[] {
  const { text, offsetMapping } = promptEditorSerializationFromDoc(doc);
  return findLinks({ text, parseLink }).flatMap((link) => {
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
  parseLink: ThreadLinkParser,
  literalLinkIndexes: number[],
): PastedThreadLink[] {
  const inserted = getChangedRanges(transaction).map(
    ({ newRange }) => newRange,
  );
  return documentLinks(transaction.doc, parseLink)
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
  parseLink: ThreadLinkParser,
  findLinks: typeof findPastedThreadLinkCandidates,
): PastedThreadLink[] {
  return documentLinks(doc, parseLink, findLinks).filter((link) =>
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
  for (const map of transaction.mapping.maps) {
    let changed = false;
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
    const resolved = new Map<string, ExperimentalComposerThreadLink>();
    let findLinks: typeof findPastedThreadLinkCandidates | undefined;
    const finish = () => {
      if (!pending.has(paste)) return;
      cancel(paste);
      if (editor.isDestroyed || !findLinks) return;
      const eligible = eligibleOccurrences(
        editor.state.doc,
        paste,
        options.parseLink,
        findLinks,
      );
      const transaction = editor.state.tr;
      for (const occurrence of eligible.reverse()) {
        const thread = resolved.get(occurrence.threadId);
        if (
          !thread ||
          occurrence.projectId !== thread.projectId ||
          !isConvertibleText(transaction.doc, occurrence)
        )
          continue;
        transaction.replaceWith(
          occurrence.from,
          occurrence.to,
          editor.schema.nodes.mention!.create(
            {
              mention: {
                kind: "thread",
                threadId: thread.threadId,
                projectId: thread.projectId,
                label: thread.label.trim() || thread.threadId,
              },
              serializedText: `@thread:${thread.threadId}`,
            },
            null,
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
          options.parseLink,
          findLinks,
        ).map((link) => link.threadId),
      )) {
        const cached = options.getCachedThread(id);
        if (cached?.threadId === id) resolved.set(id, cached);
        else missing.push(id);
      }
      if (missing.length > 0) {
        await options.resolveThreads(missing, signal, (threads) => {
          for (const thread of threads) resolved.set(thread.threadId, thread);
        });
      }
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
            options.parseLink,
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
