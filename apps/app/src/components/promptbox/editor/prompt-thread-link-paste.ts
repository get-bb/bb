import { isProjectlessProjectId } from "@bb/client-core";
import {
  THREAD_MENTION_RESOLVE_MAX_IDS,
  type ResolveThreadMentionsResponse,
} from "@bb/server-contract";
import { Extension, type Editor } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";
import {
  findPastedThreadLinkCandidates,
  type PastedThreadLink,
} from "../mentions/pasted-thread-link-candidates";
import {
  promptEditorSerializationFromDoc,
  type PromptEditorOffsetSegment,
} from "./prompt-editor-serialization";

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
  id: number;
  occurrences: PastedThreadLink[];
}

interface PasteState {
  pastes: PendingPaste[];
  nextId: number;
}

interface PasteMetadata {
  skip?: boolean;
  cancel?: boolean;
  complete?: number;
  literalLinkIndexes?: number[];
}

interface Lookup {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout> | null;
  resolved: Map<string, ThreadMentionResolution>;
  findLinks: typeof findPastedThreadLinkCandidates | null;
}

export const promptThreadLinkPasteKey = new PluginKey<PasteState>(
  "promptThreadLinkPaste",
);

function pasteMetadata(transaction: Transaction): PasteMetadata {
  const metadata: unknown = transaction.getMeta(promptThreadLinkPasteKey);
  if (!metadata || typeof metadata !== "object") return {};
  return {
    skip: "skip" in metadata && metadata.skip === true,
    cancel: "cancel" in metadata && metadata.cancel === true,
    literalLinkIndexes:
      "literalLinkIndexes" in metadata &&
      Array.isArray(metadata.literalLinkIndexes)
        ? metadata.literalLinkIndexes.filter(
            (index): index is number =>
              typeof index === "number" && Number.isInteger(index),
          )
        : [],
    ...("complete" in metadata && typeof metadata.complete === "number"
      ? { complete: metadata.complete }
      : {}),
  };
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

function occurrenceInDocument(
  link: PastedThreadLink,
  segments: PromptEditorOffsetSegment[],
): PastedThreadLink | null {
  let from: number | null = null;
  let to: number | null = null;
  let offset = link.from;
  for (const segment of segments) {
    if (segment.textTo <= link.from) continue;
    if (segment.textFrom >= link.to) break;
    if (segment.kind !== "text" || segment.textFrom > offset) return null;
    const segmentFrom = Math.max(segment.textFrom, link.from);
    const segmentTo = Math.min(segment.textTo, link.to);
    const docFrom = segment.docFrom + segmentFrom - segment.textFrom;
    if (to !== null && to !== docFrom) return null;
    from ??= docFrom;
    to = segment.docFrom + segmentTo - segment.textFrom;
    offset = segmentTo;
  }
  return from !== null && to !== null && offset === link.to
    ? { ...link, from, to }
    : null;
}

function pastedOccurrences(
  transaction: Transaction,
  origin: string,
  literalLinkIndexes: number[],
): PastedThreadLink[] {
  const inserted: { from: number; to: number }[] = [];
  for (const [index, map] of transaction.mapping.maps.entries()) {
    map.forEach((_oldFrom, _oldTo, from, to) => {
      if (from === to) return;
      const later = transaction.mapping.slice(index + 1);
      inserted.push({ from: later.map(from, 1), to: later.map(to, -1) });
    });
  }
  const { text, offsetMapping } = promptEditorSerializationFromDoc(
    transaction.doc,
  );
  let pastedIndex = 0;
  return findPastedThreadLinkCandidates({ text, origin }).flatMap((link) => {
    const occurrence = occurrenceInDocument(link, offsetMapping);
    if (
      !occurrence ||
      !inserted.some(
        (range) => occurrence.from >= range.from && occurrence.to <= range.to,
      )
    )
      return [];
    const literal = literalLinkIndexes.includes(pastedIndex++);
    return !literal && isConvertibleText(transaction.doc, occurrence)
      ? [occurrence]
      : [];
  });
}

function eligibleOccurrences(
  doc: ProseMirrorNode,
  paste: PendingPaste,
  origin: string,
  findLinks: typeof findPastedThreadLinkCandidates,
): PastedThreadLink[] {
  const { text, offsetMapping } = promptEditorSerializationFromDoc(doc);
  const eligible = findLinks({ text, origin }).flatMap((link) => {
    const occurrence = occurrenceInDocument(link, offsetMapping);
    return occurrence ? [occurrence] : [];
  });
  return paste.occurrences.filter((occurrence) =>
    eligible.some(
      (link) =>
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
  return Extension.create({
    name: "promptThreadLinkPaste",
    priority: 50,
    addProseMirrorPlugins() {
      return [
        new Plugin<PasteState>({
          key: promptThreadLinkPasteKey,
          filterTransaction(transaction) {
            if (
              transaction.docChanged &&
              transaction.getMeta("uiEvent") === "paste" &&
              !pasteMetadata(transaction).skip
            ) {
              closeHistory(transaction);
            }
            return true;
          },
          state: {
            init: () => ({ pastes: [], nextId: 0 }),
            apply(transaction, previous) {
              const metadata = pasteMetadata(transaction);
              if (metadata.cancel || isHistoryTransaction(transaction)) {
                return { pastes: [], nextId: previous.nextId };
              }
              const pastes = previous.pastes.flatMap((paste) => {
                if (paste.id === metadata.complete) return [];
                const occurrences = transaction.docChanged
                  ? paste.occurrences.flatMap((occurrence) => {
                      const mapped = mapOccurrence(occurrence, transaction);
                      return mapped ? [mapped] : [];
                    })
                  : paste.occurrences;
                return occurrences.length > 0
                  ? [{ ...paste, occurrences }]
                  : [];
              });
              let nextId = previous.nextId;
              if (
                transaction.docChanged &&
                transaction.getMeta("uiEvent") === "paste" &&
                !metadata.skip
              ) {
                const occurrences = pastedOccurrences(
                  transaction,
                  options.getOrigin(),
                  metadata.literalLinkIndexes ?? [],
                );
                if (occurrences.length > 0) {
                  pastes.push({ id: nextId++, occurrences });
                }
              }
              return { pastes, nextId };
            },
          },
          appendTransaction(transactions, _oldState, newState) {
            if (
              transactions.some((transaction) => {
                const metadata = pasteMetadata(transaction);
                return (
                  transaction.docChanged &&
                  !isHistoryTransaction(transaction) &&
                  ((transaction.getMeta("uiEvent") === "paste" &&
                    !metadata.skip) ||
                    metadata.complete !== undefined)
                );
              })
            ) {
              return closeHistory(newState.tr).setMeta("addToHistory", false);
            }
            return null;
          },
          view(view) {
            const lookups = new Map<number, Lookup>();
            let destroyed = false;
            const retire = (id: number, lookup: Lookup) => {
              lookups.delete(id);
              if (lookup.timeout !== null) clearTimeout(lookup.timeout);
              lookup.controller.abort();
            };
            const finish = (id: number, lookup: Lookup) => {
              if (destroyed || lookups.get(id) !== lookup) return;
              retire(id, lookup);
              const paste = promptThreadLinkPasteKey
                .getState(view.state)
                ?.pastes.find((pending) => pending.id === id);
              if (!paste) return;
              const eligible = lookup.findLinks
                ? eligibleOccurrences(
                    view.state.doc,
                    paste,
                    options.getOrigin(),
                    lookup.findLinks,
                  )
                : [];
              const transaction = view.state.tr;
              for (const occurrence of eligible.sort(
                (left, right) => right.from - left.from,
              )) {
                const resolved = lookup.resolved.get(occurrence.threadId);
                if (
                  !resolved ||
                  (occurrence.projectId === null
                    ? !isProjectlessProjectId(resolved.projectId)
                    : occurrence.projectId !== resolved.projectId) ||
                  !isConvertibleText(transaction.doc, occurrence)
                ) {
                  continue;
                }
                transaction.replaceWith(
                  occurrence.from,
                  occurrence.to,
                  view.state.schema.nodes.mention!.create(
                    {
                      resource: {
                        kind: "thread",
                        threadId: resolved.threadId,
                        projectId: resolved.projectId,
                        label: resolved.label.trim() || resolved.threadId,
                      },
                      serializedText: `@thread:${resolved.threadId}`,
                    },
                    null,
                    transaction.doc.nodeAt(occurrence.from)?.marks,
                  ),
                );
              }
              if (transaction.docChanged) closeHistory(transaction);
              view.dispatch(
                transaction.setMeta(promptThreadLinkPasteKey, { complete: id }),
              );
            };
            const start = (paste: PendingPaste) => {
              const lookup: Lookup = {
                controller: new AbortController(),
                timeout: null,
                resolved: new Map(),
                findLinks: null,
              };
              lookups.set(paste.id, lookup);
              lookup.timeout = setTimeout(
                () => finish(paste.id, lookup),
                2_000,
              );
              void import("../mentions/pasted-thread-links")
                .then(({ findPastedThreadLinks }) => {
                  if (destroyed || lookup.controller.signal.aborted) return;
                  lookup.findLinks = findPastedThreadLinks;
                  const currentPaste = promptThreadLinkPasteKey
                    .getState(view.state)
                    ?.pastes.find((pending) => pending.id === paste.id);
                  if (!currentPaste) return;
                  const eligible = eligibleOccurrences(
                    view.state.doc,
                    currentPaste,
                    options.getOrigin(),
                    findPastedThreadLinks,
                  );
                  const missing: string[] = [];
                  for (const threadId of new Set(
                    eligible.map((occurrence) => occurrence.threadId),
                  )) {
                    const cached = options.getCachedThread(threadId);
                    if (cached?.threadId === threadId) {
                      lookup.resolved.set(threadId, cached);
                    } else {
                      missing.push(threadId);
                    }
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
                      Promise.resolve()
                        .then(() =>
                          options.resolveThreads(ids, lookup.controller.signal),
                        )
                        .then((resolved) => {
                          if (lookup.controller.signal.aborted) return;
                          for (const thread of resolved) {
                            if (ids.includes(thread.threadId)) {
                              lookup.resolved.set(thread.threadId, thread);
                            }
                          }
                        }),
                    );
                  }
                  if (batches.length === 0) {
                    finish(paste.id, lookup);
                  } else {
                    void Promise.allSettled(batches).then(() =>
                      finish(paste.id, lookup),
                    );
                  }
                })
                .catch(() => finish(paste.id, lookup));
            };
            const sync = () => {
              const pastes =
                promptThreadLinkPasteKey.getState(view.state)?.pastes ?? [];
              for (const [id, lookup] of lookups) {
                if (!pastes.some((paste) => paste.id === id))
                  retire(id, lookup);
              }
              for (const paste of pastes) {
                if (!lookups.has(paste.id)) start(paste);
              }
            };
            sync();
            return {
              update: sync,
              destroy() {
                destroyed = true;
                for (const [id, lookup] of lookups) retire(id, lookup);
              },
            };
          },
        }),
      ];
    },
  });
}
