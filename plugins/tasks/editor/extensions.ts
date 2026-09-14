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

export type MentionItem =
  | { type: "task"; id: string; key: string; title: string }
  | { type: "thread"; id: string; title: string };

const MENTION_SCHEME = "bbtask://";
const THREAD_MENTION_SCHEME = "bbthread://";

const SVG_NS = "http://www.w3.org/2000/svg";

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
    ...icon.map(([tag, attrs]): DOMOutputSpec => [
      `${SVG_NS} ${tag}`,
      svgSpecAttributes(attrs),
    ]),
  ];
}

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
  render(node: ProseMirrorNode, parent: ProseMirrorNode, index: number): void;
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
  if (!content) return;
  const start = state.out.length;
  if (content.type.name === "image") state.render(content, cell, 0);
  else if (content.childCount > 0) state.renderInline(content);
  state.out =
    state.out.slice(0, start) + state.out.slice(start).replaceAll("|", "\\|");
}

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

function createMentionNode({
  name,
  idAttribute,
  dataAttribute,
  scheme,
  className,
  role,
  icon,
}: {
  name: string;
  idAttribute: "key" | "threadId";
  dataAttribute: string;
  scheme: string;
  className: string;
  role?: string;
  icon?: IconSvgElement;
}) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        [idAttribute]: { default: "" },
        label: { default: "" },
      };
    },
    parseHTML() {
      return [
        {
          tag: `span[${dataAttribute}]`,
          getAttrs: (element) => {
            const id = element.getAttribute(dataAttribute) ?? "";
            return id
              ? { [idAttribute]: id, label: element.textContent || id }
              : false;
          },
        },
        {
          tag: `a[href^="${scheme}"]`,
          priority: 100,
          getAttrs: (element) => {
            const href = element.getAttribute("href") ?? "";
            const id = href.slice(scheme.length);
            return id
              ? { [idAttribute]: id, label: element.textContent || id }
              : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      const id = String(node.attrs[idAttribute]);
      return [
        "span",
        { [dataAttribute]: id, class: className, ...(role ? { role } : {}) },
        ...(icon ? [mentionIconSpec(icon)] : []),
        String(node.attrs.label || id),
      ];
    },
    renderText({ node }) {
      return String(node.attrs.label || node.attrs[idAttribute]);
    },
    addStorage() {
      return {
        markdown: {
          serialize(
            state: { write(value: string): void },
            node: { attrs: Record<string, string> },
          ) {
            const id = node.attrs[idAttribute];
            state.write(`[${node.attrs.label || id}](${scheme}${id})`);
          },
        },
      };
    },
  });
}

const TaskMention = createMentionNode({
  name: "taskMention",
  idAttribute: "key",
  dataAttribute: "data-task-mention",
  scheme: MENTION_SCHEME,
  className: "bb-tasks-mention",
});

const ThreadMention = createMentionNode({
  name: "threadMention",
  idAttribute: "threadId",
  dataAttribute: "data-thread-mention",
  scheme: THREAD_MENTION_SCHEME,
  className: "bb-tasks-mention bb-tasks-thread-mention",
  role: "link",
  icon: BubbleChatIcon,
});

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
    MarkdownTable.configure({ renderWrapper: true }),
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
      transformPastedText: true,
    }),
  ];
}
