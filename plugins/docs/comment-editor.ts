import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { makeAnchor, resolveAnchor, type ListedComment } from "./comments.js";
import { visibleMarkdown } from "./comment-text.js";

export type CommentRange = { id: string; from: number; to: number };
export const commentHighlightKey = new PluginKey<DecorationSet>(
  "docs-comments",
);
export function visibleEditor(doc: Node): {
  text: string;
  positions: number[];
} {
  let text = "";
  const positions: number[] = [];
  function append(value: string, position: number, atomic = false) {
    text += value;
    for (let i = 0; i < value.length; i++)
      positions.push(position + (atomic ? 0 : i));
  }
  doc.descendants((node, position) => {
    if (node.isTextblock || (node.isBlock && node.isAtom)) {
      if (positions.length) append("\n\n", position, true);
      if (node.isAtom) {
        append("\ufffc", position, true);
        return false;
      }
    }
    if (node.isText) append(node.text ?? "", position);
    else if (node.type.name === "hardBreak") append("\n", position, true);
    else if (node.isInline && node.isAtom) append("\ufffc", position, true);
    return true;
  });
  return { text, positions };
}
export function alignOffsets(from: string, to: string): Int32Array {
  const map = new Int32Array(from.length).fill(-1);
  let i = 0;
  let j = 0;
  while (i < from.length && j < to.length) {
    if (from[i] === to[j]) map[i++] = j++;
    else if (/\s/.test(from[i]!)) i++;
    else if (/\s/.test(to[j]!)) j++;
    else break;
  }
  return map;
}
export function mapRange(
  from: string,
  to: string,
  map: Int32Array,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const first = map[start];
  const last = map[end - 1];
  if (first === undefined || last === undefined || first < 0 || last < first)
    return null;
  return to.slice(first, last + 1) === from.slice(start, end)
    ? { start: first, end: last + 1 }
    : null;
}
export function threadRanges(
  doc: Node,
  threads: ListedComment[],
  proposalBase: string | null,
  savedContent: string | null = null,
): CommentRange[] {
  const visible = visibleEditor(doc);
  const saved =
    proposalBase === null ? null : visibleMarkdown(proposalBase).text;
  const stored =
    saved === null && savedContent !== null
      ? visibleMarkdown(savedContent).text
      : null;
  const map = stored === null ? null : alignOffsets(stored, visible.text);
  const ranges: CommentRange[] = [];
  for (const thread of threads) {
    let { start, end } = thread.anchor;
    if (thread.resolvedAt || start === null || end === null) continue;
    if (saved !== null)
      ({ start, end } = resolveAnchor(
        { text: visible.text, lines: [] },
        "",
        makeAnchor(saved, start, end, "saved"),
      ));
    else if (stored !== null && map !== null) {
      const mapped =
        stored.slice(start, end) === thread.anchor.quote
          ? mapRange(stored, visible.text, map, start, end)
          : null;
      if (!mapped) continue;
      ({ start, end } = mapped);
    } else if (visible.text.slice(start, end) !== thread.anchor.quote) continue;
    if (start === null || end === null) continue;
    const from = visible.positions[start];
    const to = visible.positions[end - 1];
    if (from !== undefined && to !== undefined)
      ranges.push({ id: thread.id, from, to: to + 1 });
  }
  return ranges;
}
export function highlightRanges(
  doc: Node,
  current: DecorationSet | undefined,
  threads: ListedComment[],
  proposalBase: string | null,
  authoritative: boolean,
  savedContent: string | null = null,
): CommentRange[] {
  if (proposalBase !== null || authoritative)
    return threadRanges(doc, threads, proposalBase, savedContent);
  const open = new Set(
    threads.filter((thread) => !thread.resolvedAt).map((thread) => thread.id),
  );
  return current
    ? commentRanges(doc, current).filter((range) => open.has(range.id))
    : [];
}
export function commentRanges(
  doc: Node,
  decorations: DecorationSet,
): CommentRange[] {
  return decorations
    .find()
    .map((item) => ({ id: String(item.spec.id), from: item.from, to: item.to }))
    .filter(
      (item, i, ranges) =>
        ranges.findIndex((other) => other.id === item.id) === i,
    );
}
export function createCommentHighlights() {
  return Extension.create({
    name: "docsComments",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: commentHighlightKey,
          state: {
            init: () => DecorationSet.empty,
            apply(transaction, current) {
              const update:
                | { ranges: CommentRange[]; active: string | null }
                | undefined = transaction.getMeta(commentHighlightKey);
              if (transaction.getMeta("preventUpdate"))
                return DecorationSet.empty;
              if (update)
                return DecorationSet.create(
                  transaction.doc,
                  update.ranges
                    .filter(
                      (range) =>
                        range.from < range.to &&
                        range.to <= transaction.doc.content.size,
                    )
                    .map((range) => {
                      const attrs = {
                        class: "docs-comment-highlight",
                        "data-comment-id": range.id,
                        "data-active": String(range.id === update.active),
                      };
                      const node = transaction.doc.nodeAt(range.from);
                      return node?.isBlock &&
                        node.isAtom &&
                        range.to === range.from + node.nodeSize
                        ? Decoration.node(range.from, range.to, attrs, {
                            id: range.id,
                          })
                        : Decoration.inline(range.from, range.to, attrs, {
                            id: range.id,
                            inclusiveStart: false,
                            inclusiveEnd: false,
                          });
                    }),
                );
              return current.map(transaction.mapping, transaction.doc);
            },
          },
          props: {
            decorations: (state) => commentHighlightKey.getState(state),
          },
        }),
      ];
    },
  });
}
