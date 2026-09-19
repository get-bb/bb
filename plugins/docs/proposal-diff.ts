import { Extension } from "@tiptap/core";
import {
  DOMSerializer,
  Fragment,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffArrays } from "diff";

type DiffState = { decorations: DecorationSet; beforeDeletion: number | null };
type Part<T> = { value: T[]; added?: boolean; removed?: boolean };
type Token = { key: string; from: number; to: number };

export const proposalDiffKey = new PluginKey<DiffState>("docsProposalDiff");

function changes<T>(
  left: T[],
  right: T[],
  equal: (a: T, b: T) => boolean,
  deadline: number,
): Part<T>[] {
  const remaining = deadline - Date.now();
  const result =
    remaining > 0
      ? diffArrays(left, right, {
          comparator: equal,
          timeout: remaining,
          maxEditLength: 512,
        })
      : undefined;
  if (result) return result;
  let start = 0;
  while (
    start < Math.min(left.length, right.length) &&
    equal(left[start]!, right[start]!)
  )
    start++;
  let end = 0;
  while (
    end < Math.min(left.length, right.length) - start &&
    equal(left[left.length - end - 1]!, right[right.length - end - 1]!)
  )
    end++;
  return [
    { value: right.slice(0, start) },
    { value: left.slice(start, left.length - end), removed: true },
    { value: right.slice(start, right.length - end), added: true },
    { value: end ? right.slice(-end) : [] },
  ].filter((part) => part.value.length > 0);
}

function tokens(node: ProseMirrorNode): Token[] {
  const result: Token[] = [];
  node.forEach((child, offset) => {
    if (child.isText) {
      const marks = JSON.stringify(child.marks.map((mark) => mark.toJSON()));
      let position = offset;
      for (const character of child.text ?? "") {
        result.push({
          key: `${marks}:${character}`,
          from: position,
          to: position + character.length,
        });
        position += character.length;
      }
    } else
      result.push({
        key: JSON.stringify(child.toJSON()),
        from: offset,
        to: offset + child.nodeSize,
      });
  });
  return result;
}

function buildDecorations(
  state: EditorState,
  base: ProseMirrorNode | null,
  beforeDeletion: number | null,
): DecorationSet {
  if (!base) return DecorationSet.empty;
  const result: Decoration[] = [];
  const serializer = DOMSerializer.fromSchema(state.schema);
  const deadline = Date.now() + 40;
  const added = "rounded-sm bg-diff-added/10 text-diff-added";
  const removed = "rounded-sm bg-diff-removed/10 text-diff-removed select-none";
  const widget = (
    position: number,
    fragment: Fragment,
    key: string,
    block: boolean,
  ) => {
    const side = beforeDeletion === position ? 1 : -1;
    result.push(
      Decoration.widget(
        position,
        (view) => {
          const document = view.dom.ownerDocument;
          const Element = document.defaultView?.HTMLElement;
          const serialized =
            block && fragment.childCount === 1
              ? serializer.serializeNode(fragment.firstChild!, { document })
              : null;
          const element =
            Element && serialized instanceof Element
              ? serialized
              : document.createElement(block ? "div" : "del");
          element.classList.add(...removed.split(" "));
          element.contentEditable = "false";
          element.dataset.proposalRemoved = "true";
          element.setAttribute("aria-label", "Proposed deletion");
          if (block) element.style.textDecoration = "line-through";
          if (element !== serialized)
            element.append(
              serializer.serializeFragment(fragment, { document }),
            );
          return element;
        },
        { side, key: `${key}:${side}`, ignoreSelection: true },
      ),
    );
  };
  const compare = (
    oldNode: ProseMirrorNode,
    node: ProseMirrorNode,
    position: number,
    oldPosition: number,
  ) => {
    if (oldNode.eq(node)) return;
    if (oldNode.isTextblock && node.isTextblock) {
      const parts = changes(
        tokens(oldNode),
        tokens(node),
        (a, b) => a.key === b.key,
        deadline,
      );
      let cursor = 0;
      for (const part of parts) {
        const first = part.value[0];
        const last = part.value.at(-1);
        if (!first || !last) continue;
        if (part.removed)
          widget(
            position + 1 + cursor,
            oldNode.content.cut(first.from, last.to),
            `inline:${oldPosition}:${first.from}:${last.to}`,
            false,
          );
        else {
          if (part.added)
            result.push(
              Decoration.inline(
                position + 1 + first.from,
                position + 1 + last.to,
                { class: added, "data-proposal-added": "true" },
              ),
            );
          cursor = last.to;
        }
      }
      if (!oldNode.sameMarkup(node) && position >= 0)
        result.push(
          Decoration.node(position, position + node.nodeSize, {
            class: added,
            "data-proposal-added": "true",
          }),
        );
      return;
    }
    if (position >= 0 && !oldNode.sameMarkup(node))
      result.push(
        Decoration.node(position, position + node.nodeSize, {
          class: added,
          "data-proposal-added": "true",
        }),
      );
    const oldChildren: {
      node: ProseMirrorNode;
      offset: number;
      key: string;
    }[] = [];
    const children: typeof oldChildren = [];
    oldNode.forEach((child, offset) =>
      oldChildren.push({
        node: child,
        offset,
        key: JSON.stringify(child.toJSON()),
      }),
    );
    node.forEach((child, offset) =>
      children.push({
        node: child,
        offset,
        key: JSON.stringify(child.toJSON()),
      }),
    );
    const parts = changes(
      oldChildren,
      children,
      (a, b) => a.key === b.key,
      deadline,
    );
    let cursor = 0;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      if (part.removed) {
        const next = parts[index + 1];
        const replacements = next?.added ? next.value : [];
        const count = Math.max(part.value.length, replacements.length);
        for (let item = 0; item < count; item++) {
          const previous = part.value[item];
          const replacement = replacements[item];
          if (
            previous &&
            replacement &&
            previous.node.type === replacement.node.type &&
            !replacement.node.isLeaf
          ) {
            compare(
              previous.node,
              replacement.node,
              position + 1 + replacement.offset,
              oldPosition + 1 + previous.offset,
            );
          } else {
            if (previous)
              widget(
                position + 1 + (replacement?.offset ?? cursor),
                Fragment.from(previous.node),
                `block:${oldPosition + 1 + previous.offset}`,
                true,
              );
            if (replacement)
              result.push(
                Decoration.node(
                  position + 1 + replacement.offset,
                  position + 1 + replacement.offset + replacement.node.nodeSize,
                  { class: added, "data-proposal-added": "true" },
                ),
              );
          }
          if (replacement)
            cursor = replacement.offset + replacement.node.nodeSize;
        }
        if (next?.added) index++;
      } else {
        for (const child of part.value) {
          if (part.added)
            result.push(
              Decoration.node(
                position + 1 + child.offset,
                position + 1 + child.offset + child.node.nodeSize,
                { class: added, "data-proposal-added": "true" },
              ),
            );
          cursor = child.offset + child.node.nodeSize;
        }
      }
    }
  };
  compare(base, state.doc, -1, -1);
  return DecorationSet.create(state.doc, result);
}

export function createProposalDiff({
  getBaseDocument,
}: {
  getBaseDocument: () => ProseMirrorNode | null;
}) {
  return Extension.create({
    name: "docsProposalDiff",
    addProseMirrorPlugins() {
      return [
        new Plugin<DiffState>({
          key: proposalDiffKey,
          state: {
            init: (_, state) => ({
              decorations: buildDecorations(state, getBaseDocument(), null),
              beforeDeletion: null,
            }),
            apply: (transaction, previous, _oldState, state) => {
              const metadata:
                | { beforeDeletion?: number | null; refresh?: boolean }
                | undefined = transaction.getMeta(proposalDiffKey);
              let beforeDeletion =
                previous.beforeDeletion === null
                  ? null
                  : transaction.mapping.map(previous.beforeDeletion);
              if (metadata?.beforeDeletion !== undefined)
                beforeDeletion = metadata.beforeDeletion;
              else if (transaction.selectionSet && !transaction.docChanged)
                beforeDeletion = null;
              if (
                !transaction.docChanged &&
                !metadata?.refresh &&
                beforeDeletion === previous.beforeDeletion
              )
                return previous;
              return {
                decorations: buildDecorations(
                  state,
                  getBaseDocument(),
                  beforeDeletion,
                ),
                beforeDeletion,
              };
            },
          },
          props: {
            decorations: (state) =>
              proposalDiffKey.getState(state)?.decorations ??
              DecorationSet.empty,
            handleKeyDown: (view, event) => {
              if (
                event.key !== "Backspace" ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                !view.state.selection.empty
              )
                return false;
              const position = view.state.selection.from;
              const selection = view.dom.ownerDocument.getSelection();
              if (!selection?.isCollapsed || !selection.rangeCount)
                return false;
              const deleted = Array.from(
                view.dom.querySelectorAll<HTMLElement>(
                  "[data-proposal-removed]",
                ),
              ).find((element) => view.posAtDOM(element, 0) === position);
              if (!deleted) return false;
              const end = view.dom.ownerDocument.createRange();
              end.setStartAfter(deleted);
              end.collapse(true);
              if (selection.getRangeAt(0).compareBoundaryPoints(0, end) < 0)
                return false;
              view.dispatch(
                view.state.tr.setMeta(proposalDiffKey, {
                  beforeDeletion: position,
                }),
              );
              const before = view.domAtPos(position, -1);
              selection.collapse(before.node, before.offset);
              return true;
            },
            handleDOMEvents: {
              pointerdown: (view) => {
                if (
                  proposalDiffKey.getState(view.state)?.beforeDeletion !== null
                )
                  view.dispatch(
                    view.state.tr.setMeta(proposalDiffKey, {
                      beforeDeletion: null,
                    }),
                  );
                return false;
              },
            },
          },
        }),
      ];
    },
  });
}
