import {
  Extension,
  getHTMLFromFragment,
  InputRule,
  Node,
  type Extensions,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  Fragment,
  type DOMOutputSpec,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import type { IconSvgElement } from "@hugeicons/react";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";

/** One entry in the @-mention popover: a task or a bb thread. */
export type MentionItem =
  | { type: "task"; id: string; key: string; title: string }
  | { type: "thread"; id: string; title: string };

const MENTION_SCHEME = "bbtask://";
const THREAD_MENTION_SCHEME = "bbthread://";

const SVG_NS = "http://www.w3.org/2000/svg";

// Hugeicons ships icon artwork as React-style [tag, camelCaseAttrs] tuples;
// ProseMirror DOM specs need real (kebab-case) SVG attribute names.
function svgSpecAttributes(
  attrs: Record<string, string | number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "key") continue;
    out[key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)] =
      String(value);
  }
  return out;
}

function mentionIconSpec(icon: IconSvgElement): DOMOutputSpec {
  return [
    `${SVG_NS} svg`,
    {
      viewBox: "0 0 24 24",
      fill: "none",
      class: "bb-tasks-mention-icon",
      "aria-hidden": "true",
    },
    ...icon.map(
      ([tag, attrs]): DOMOutputSpec => [
        `${SVG_NS} ${tag}`,
        svgSpecAttributes(attrs),
      ],
    ),
  ];
}

// tiptap-markdown only adds a `tight` attribute to bulletList/orderedList, so
// task lists would always serialize loose (blank lines between items).
// Mirror its attribute here: default tight, loose only when the source
// markdown had paragraph-separated items.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (element) =>
          element.getAttribute("data-tight") === "true" ||
          !element.querySelector("p"),
        renderHTML: (attributes) => ({
          "data-tight": attributes.tight ? "true" : null,
        }),
      },
    };
  },
});

// Typing "[ ] " / "[x] " at the start of a line turns into a task list item,
// mirroring how the markdown source spells checkboxes.
const MarkdownTaskInput = Extension.create({
  name: "markdownTaskInput",
  priority: 200,
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[([ xX]?)\]\s$/,
        handler: ({ range, match, chain }) => {
          const commands = chain().deleteRange(range).toggleTaskList();
          if (/[xX]/.test(match[1] ?? ""))
            commands.updateAttributes("taskItem", { checked: true });
          commands.run();
        },
      }),
    ];
  },
});

interface TableMarkdownState {
  out: string;
  inTable: boolean;
  write(value: string): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
  renderInline(node: ProseMirrorNode): void;
}

function tableChildren(node: ProseMirrorNode): readonly ProseMirrorNode[] {
  return node.content.content;
}

function hasMergedCell(node: ProseMirrorNode): boolean {
  return node.attrs.colspan > 1 || node.attrs.rowspan > 1;
}

function isMarkdownTable(node: ProseMirrorNode): boolean {
  const [header, ...body] = tableChildren(node);
  if (!header) return false;
  if (
    tableChildren(header).some(
      (cell) =>
        cell.type.name !== "tableHeader" ||
        hasMergedCell(cell) ||
        cell.childCount > 1,
    )
  ) {
    return false;
  }
  return !body.some((row) =>
    tableChildren(row).some(
      (cell) =>
        cell.type.name === "tableHeader" ||
        hasMergedCell(cell) ||
        cell.childCount > 1,
    ),
  );
}

function renderTableCell(
  state: TableMarkdownState,
  cell: ProseMirrorNode,
): void {
  const content = cell.firstChild;
  if (!content?.textContent.trim()) return;
  const start = state.out.length;
  state.renderInline(content);
  state.out =
    state.out.slice(0, start) +
    state.out.slice(start).replaceAll("|", "\\|");
}

// tiptap-markdown's table serializer does not escape pipes inside cells.
// Escaping every rendered pipe keeps text, code, and link destinations inside
// their original cell when an edited agent comment is serialized again.
const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TableMarkdownState, node: ProseMirrorNode) {
          if (!isMarkdownTable(node)) {
            state.write(
              getHTMLFromFragment(Fragment.from(node), node.type.schema),
            );
            state.closeBlock(node);
            return;
          }

          state.inTable = true;
          node.forEach((row, _offset, rowIndex) => {
            state.write("| ");
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex > 0) state.write(" | ");
              renderTableCell(state, cell);
            });
            state.write(" |");
            state.ensureNewLine();
            if (rowIndex === 0) {
              state.write(
                `| ${Array.from({ length: row.childCount }, () => "---").join(" | ")} |`,
              );
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

// Inline atom that renders as a pill and serializes to markdown as a
// bbtask:// link: [TSK-42](bbtask://TSK-42).
const TaskMention = Node.create({
  name: "taskMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      key: { default: "" },
      label: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-task-mention]",
        getAttrs: (element) => {
          const key = element.getAttribute("data-task-mention") ?? "";
          return key ? { key, label: element.textContent || key } : false;
        },
      },
      {
        // Markdown input arrives as <a href="bbtask://KEY">label</a>; this
        // rule must outrank the Link mark's a[href] rule.
        tag: `a[href^="${MENTION_SCHEME}"]`,
        priority: 100,
        getAttrs: (element) => {
          const href = element.getAttribute("href") ?? "";
          const key = href.slice(MENTION_SCHEME.length);
          return key ? { key, label: element.textContent || key } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-task-mention": String(node.attrs.key),
        class: "bb-tasks-mention",
      },
      String(node.attrs.label || node.attrs.key),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.label || node.attrs.key);
  },
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(value: string): void },
          node: { attrs: { key: string; label: string } },
        ) {
          state.write(
            `[${node.attrs.label || node.attrs.key}](${MENTION_SCHEME}${node.attrs.key})`,
          );
        },
      },
    };
  },
});

// Inline atom that renders as a pill (with a small chat glyph to distinguish
// it from task pills) and serializes to markdown as a bbthread:// link:
// [Fix login flow](bbthread://thr_abc).
const ThreadMention = Node.create({
  name: "threadMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      threadId: { default: "" },
      label: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-thread-mention]",
        getAttrs: (element) => {
          const threadId = element.getAttribute("data-thread-mention") ?? "";
          return threadId
            ? { threadId, label: element.textContent || threadId }
            : false;
        },
      },
      {
        // Markdown input arrives as <a href="bbthread://thr_x">label</a>; this
        // rule must outrank the Link mark's a[href] rule.
        tag: `a[href^="${THREAD_MENTION_SCHEME}"]`,
        priority: 100,
        getAttrs: (element) => {
          const href = element.getAttribute("href") ?? "";
          const threadId = href.slice(THREAD_MENTION_SCHEME.length);
          return threadId
            ? { threadId, label: element.textContent || threadId }
            : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-thread-mention": String(node.attrs.threadId),
        class: "bb-tasks-mention bb-tasks-thread-mention",
        role: "link",
      },
      mentionIconSpec(BubbleChatIcon),
      String(node.attrs.label || node.attrs.threadId),
    ];
  },
  renderText({ node }) {
    return String(node.attrs.label || node.attrs.threadId);
  },
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write(value: string): void },
          node: { attrs: { threadId: string; label: string } },
        ) {
          state.write(
            `[${node.attrs.label || node.attrs.threadId}](${THREAD_MENTION_SCHEME}${node.attrs.threadId})`,
          );
        },
      },
    };
  },
});

// Keeps a trailing empty paragraph after a terminal leaf block (a block image
// or horizontal rule). Such a leaf offers no place for a text caret after it,
// so a description whose only content is an image would otherwise be
// impossible to focus or extend. The empty paragraph adds no characters when
// the document is serialized back to markdown for an image-terminal document.
// Runs only on transactions (not initial construction) and only while the
// editor is editable; the host seeds the initial document separately.
const TrailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("trailingParagraph"),
        appendTransaction: (_transactions, _oldState, newState) => {
          if (!editor.isEditable) return null;
          const last = newState.doc.lastChild;
          const paragraph = newState.schema.nodes.paragraph;
          if (!paragraph || !last || !last.type.isLeaf) return null;
          return newState.tr.insert(
            newState.doc.content.size,
            paragraph.create(),
          );
        },
      }),
    ];
  },
});

export interface MentionSuggestionHandle {
  getItems(query: string): Promise<MentionItem[]>;
  onChange(props: SuggestionProps<MentionItem, MentionItem>): void;
  onExit(): void;
  onKeyDown(event: KeyboardEvent): boolean;
}

// Wires the "@" suggestion popover to the host component. Without a handle
// the extension contributes nothing, keeping the editor inert when the
// mentionItems prop is absent.
const MentionSuggestion = Extension.create<{
  handle: MentionSuggestionHandle | null;
}>({
  name: "taskMentionSuggestion",
  addOptions() {
    return { handle: null };
  },
  addProseMirrorPlugins() {
    const handle = this.options.handle;
    if (!handle) return [];
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        char: "@",
        pluginKey: new PluginKey("taskMentionSuggestion"),
        items: ({ query }) => handle.getItems(query),
        command: ({ editor, range, props }) => {
          const node =
            props.type === "thread"
              ? {
                  type: ThreadMention.name,
                  attrs: { threadId: props.id, label: props.title },
                }
              : {
                  type: TaskMention.name,
                  attrs: { key: props.key, label: props.key },
                };
          editor
            .chain()
            .focus()
            .insertContentAt(range, [node, { type: "text", text: " " }])
            .run();
        },
        render: () => ({
          onStart: (props) => handle.onChange(props),
          onUpdate: (props) => handle.onChange(props),
          onExit: () => handle.onExit(),
          onKeyDown: (props) => handle.onKeyDown(props.event),
        }),
      }),
    ];
  },
});

export function createEditorExtensions(options?: {
  placeholder?: () => string;
  mentionHandle?: MentionSuggestionHandle;
}): Extensions {
  return [
    StarterKit,
    Link.configure({ openOnClick: false, autolink: true }),
    Image.configure({ allowBase64: false }),
    TightTaskList,
    TaskItem.configure({ nested: true }),
    MarkdownTable.configure({ resizable: true, lastColumnResizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    MarkdownTaskInput,
    TaskMention,
    ThreadMention,
    TrailingParagraph,
    MentionSuggestion.configure({
      handle: options?.mentionHandle ?? null,
    }),
    Placeholder.configure({
      placeholder: () => options?.placeholder?.() ?? "",
    }),
    Markdown.configure({
      html: true,
      tightLists: true,
      bulletListMarker: "-",
      linkify: true,
    }),
  ];
}
