import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  definePluginApp,
  experimental_FileLink as FileLink,
  useBbNavigate,
  useComposer,
  useRpc,
  useRealtime,
  type PluginFileOpenerProps,
  type PluginMessageDirectiveProps,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
  type ExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk/app";
import {
  DOMParser as ProseMirrorDOMParser,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { createProposalDiff, proposalDiffKey } from "./proposal-diff.js";
import {
  useDocumentSession,
  useSavedDocument,
  type DocumentIO,
} from "./document-session.js";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import type { docsRpcContract } from "./server.js";
import { isRecord, parseMarkdownDocument } from "./markdown-document.js";
import {
  Editor,
  Extension,
  InputRule,
  Node,
  mergeAttributes,
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
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { toast } from "sonner";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileAddIcon from "@hugeicons/core-free-icons/FileAddIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import HtmlFile01Icon from "@hugeicons/core-free-icons/HtmlFile01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@bb/shared-ui/button";
import { DelayedLoading } from "@bb/shared-ui/delayed-loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePortalScopeProps } from "@bb/shared-ui/lib/portal-scope";

interface Vault {
  id: string;
  name: string;
  hostId: string | null;
  rootPath: string;
}

interface Host {
  id: string;
  name: string;
  status: "connected" | "disconnected";
}

interface VaultEntry {
  kind: "file" | "directory";
  path: string;
}

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

interface NotesData {
  vaults: Vault[];
  vault: Vault;
  hosts: Host[];
  entries: VaultEntry[];
  entryOrder: string[];
  notes: NoteSummary[];
  truncated: boolean;
  error: string | null;
}

interface PreviewLease {
  baseUrl: string;
  expiresAtMs: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function dirname(value: string): string {
  const index = value.lastIndexOf("/");
  return index < 0 ? "" : value.slice(0, index);
}

function normalizeRelative(base: string, relative: string): string {
  if (!relative.startsWith(".")) return relative.replace(/^\//, "");
  const stack = base ? base.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function relativeFrom(base: string, target: string): string {
  const from = base ? base.split("/") : [];
  const to = target.split("/");
  while (from[0] && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return (
    `${from.map(() => "..").join("/")}${from.length && to.length ? "/" : ""}${to.join("/")}` ||
    "."
  );
}

function previewUrl(baseUrl: string, notePath: string, source: string): string {
  if (/^(https?:|data:|blob:|#)/i.test(source)) return source;
  return `${baseUrl}/${encodePath(normalizeRelative(dirname(notePath), source))}`;
}

function displayMarkdown(
  content: string,
  baseUrl: string,
  notePath: string,
): string {
  const withImages = content.replace(
    /(!\[[^\]]*\]\()([^\s)]+)([^)]*\))/g,
    (_match, start: string, source: string, end: string) =>
      `${start}${previewUrl(baseUrl, notePath, source)}${end}`,
  );
  return withImages.replace(
    /^::html\{src="([^"]+)"(?: height="(\d+)")?\}\s*$/gm,
    (_match, source: string, height: string | undefined) =>
      `<div data-simple-html-embed="true" data-src="${encodeURIComponent(source)}" data-height="${height ?? "360"}"></div>`,
  );
}

function storedMarkdown(
  content: string,
  baseUrl: string,
  notePath: string,
): string {
  const prefix = `${baseUrl}/`;
  return content.replace(
    /(!\[[^\]]*\]\()([^\s)]+)([^)]*\))/g,
    (_match, start: string, source: string, end: string) => {
      if (!source.startsWith(prefix)) return `${start}${source}${end}`;
      const target = source
        .slice(prefix.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const relative = relativeFrom(dirname(notePath), target);
      return `${start}${relative.startsWith(".") ? relative : `./${relative}`}${end}`;
    },
  );
}

interface HtmlEmbedOptions {
  baseUrl: string;
  notePath: string;
}

const HtmlEmbed = Node.create<HtmlEmbedOptions>({
  name: "simpleHtmlEmbed",
  group: "block",
  atom: true,
  isolating: true,
  addOptions() {
    return { baseUrl: "", notePath: "" };
  },
  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element) =>
          decodeURIComponent(element.getAttribute("data-src") ?? ""),
        renderHTML: (attributes) => ({
          "data-src": encodeURIComponent(String(attributes.src)),
        }),
      },
      height: {
        default: 360,
        parseHTML: (element) =>
          Number(element.getAttribute("data-height") ?? 360),
        renderHTML: (attributes) => ({
          "data-height": String(attributes.height),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-simple-html-embed="true"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-simple-html-embed": "true" }),
    ];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("section");
      dom.className = "simple-html-embed";
      dom.contentEditable = "false";
      const header = document.createElement("div");
      header.className = "simple-html-embed-header";
      header.textContent = `◇ ${String(node.attrs.src)} · sandboxed`;
      const iframe = document.createElement("iframe");
      iframe.title = `Embedded HTML: ${String(node.attrs.src)}`;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.height = `${Math.min(1200, Math.max(120, Number(node.attrs.height) || 360))}px`;
      iframe.src = previewUrl(
        this.options.baseUrl,
        this.options.notePath,
        String(node.attrs.src),
      );
      dom.append(header, iframe);
      return { dom };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write(value: string): void;
            closeBlock(node: unknown): void;
          },
          node: { attrs: { src: string; height: number } },
        ) {
          state.write(
            `::html{src="${node.attrs.src}" height="${node.attrs.height}"}`,
          );
          state.closeBlock(node);
        },
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

const STYLE_MARKER = "data-bb-simple-notes-styles";
const EDITOR_CSS = `
.bb-simple-notes-editor .tiptap {
  outline: none; width: 100%; max-width: 48em; margin: 0 auto; padding: 3rem 1.5rem 40vh;
  font-size: 15px; line-height: 1.75; color: var(--foreground); caret-color: var(--foreground);
  overflow-wrap: break-word; -webkit-font-smoothing: antialiased;
}
.bb-simple-notes-editor[data-inline="true"] .tiptap { padding: 1.25rem 1.5rem; max-width: none; min-height: 8rem; font-size: inherit; }
.bb-simple-notes-editor .tiptap > :first-child,
.bb-simple-notes-editor .tiptap li > :first-child,
.bb-simple-notes-editor .tiptap blockquote > :first-child { margin-top: 0; }
.bb-simple-notes-editor .tiptap p { margin: 1.25em 0 0; }
.bb-simple-notes-editor .tiptap h1,
.bb-simple-notes-editor .tiptap h2,
.bb-simple-notes-editor .tiptap h3,
.bb-simple-notes-editor .tiptap h4,
.bb-simple-notes-editor .tiptap h5,
.bb-simple-notes-editor .tiptap h6 { margin-bottom: 0; color: var(--foreground); font-weight: 600; }
.bb-simple-notes-editor .tiptap h1 { font-size: 1.75em; line-height: 1.3; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h2 { font-size: 1.25em; line-height: 1.4; margin-top: 1.75em; }
.bb-simple-notes-editor .tiptap h3 { font-size: 1.125em; line-height: 1.45; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h4 { font-size: 1em; line-height: 1.5; margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap h5 { font-size: 0.875em; line-height: 1.5; font-weight: 500; color: var(--muted-foreground); margin-top: 1.43em; }
.bb-simple-notes-editor .tiptap h6 { font-size: 0.8125em; line-height: 1.5; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted-foreground); margin-top: 1.54em; }
.bb-simple-notes-editor .tiptap :is(h1, h2, h3, h4, h5, h6) + * { margin-top: 1em; }
.bb-simple-notes-editor .tiptap ul, .bb-simple-notes-editor .tiptap ol { margin: 1.25em 0 0; padding-left: 1.5em; }
.bb-simple-notes-editor .tiptap ul { list-style: disc; }
.bb-simple-notes-editor .tiptap ol { list-style: decimal; }
.bb-simple-notes-editor .tiptap li { margin-top: 0.5em; padding-left: 0.4em; }
.bb-simple-notes-editor .tiptap li > p, .bb-simple-notes-editor .tiptap li > ul, .bb-simple-notes-editor .tiptap li > ol { margin-top: 0.5em; }
.bb-simple-notes-editor .tiptap li::marker { color: var(--muted-foreground); }
.bb-simple-notes-editor .tiptap a { color: inherit; font-weight: 500; text-decoration: underline; text-decoration-color: color-mix(in oklab, currentColor 30%, transparent); cursor: pointer; }
.bb-simple-notes-editor .tiptap a:hover { text-decoration-color: currentColor; }
.bb-simple-notes-editor .tiptap a:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 0.125em; }
.bb-simple-notes-editor .tiptap strong { font-weight: 600; }
.bb-simple-notes-editor .tiptap code { background: var(--muted); border-radius: min(calc(var(--radius) * 0.6), 0.35em); padding: 0.125em 0.3em; font-size: 0.85em; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
.bb-simple-notes-editor .tiptap pre { background: var(--muted); border-radius: var(--radius); padding: 0.75em 1em; overflow-x: auto; font-size: 0.875em; line-height: 1.5; margin: 1.43em 0 0; tab-size: 2; }
.bb-simple-notes-editor .tiptap pre code { background: none; padding: 0; font-size: inherit; }
.bb-simple-notes-editor .tiptap blockquote { border-left: 2px solid var(--border); padding-left: 1em; margin: 1.25em 0 0; }
.bb-simple-notes-editor .tiptap hr { border: none; border-top: 1px solid var(--border); margin: 3em 0 0; }
.bb-simple-notes-editor .tiptap hr + :is(h1, h2, h3, h4) { margin-top: 1.25em; }
.bb-simple-notes-editor .tiptap img { display: block; max-width: 100%; max-height: 38rem; margin: 1.5em auto 0; border-radius: var(--radius); border: 1px solid var(--border); }
.bb-simple-notes-editor .tiptap .tableWrapper { margin: 1.5em 0 0; overflow-x: auto; }
.bb-simple-notes-editor .tiptap table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.bb-simple-notes-editor .tiptap th,
.bb-simple-notes-editor .tiptap td { position: relative; min-width: 6rem; border: 1px solid var(--border); padding: 0.5em 0.65em; text-align: left; vertical-align: top; }
.bb-simple-notes-editor .tiptap th { background: var(--muted); font-weight: 600; }
.bb-simple-notes-editor .tiptap :is(th, td) > p { margin-top: 0; }
.bb-simple-notes-editor .tiptap :is(th, td) > p + p { margin-top: 0.65em; }
.bb-simple-notes-editor .tiptap .selectedCell::after { position: absolute; inset: 0; z-index: 2; pointer-events: none; content: ""; background: color-mix(in oklab, var(--primary) 14%, transparent); }
.bb-simple-notes-editor .tiptap .column-resize-handle { position: absolute; top: 0; right: -2px; bottom: -1px; width: 4px; z-index: 3; pointer-events: none; background: var(--primary); }
.bb-simple-notes-editor .tiptap.resize-cursor { cursor: col-resize; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] ul[data-type="taskList"] { margin-top: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; margin-top: 0.5em; padding-left: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > label { flex: 0 0 auto; display: inline-flex; align-items: center; height: 1.7em; user-select: none; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > div > p { line-height: 1.75; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li > div > p:first-child { margin-top: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] input[type="checkbox"] { display: block; width: 15px; height: 15px; accent-color: var(--primary); cursor: pointer; margin: 0; }
.bb-simple-notes-editor .tiptap ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--muted-foreground); text-decoration: line-through; }
.bb-simple-notes-editor .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--muted-foreground); }
.bb-simple-notes-editor .tiptap ::selection { background: color-mix(in oklab, var(--primary) 22%, transparent); }
.simple-html-embed { margin:1.5em 0 0; overflow:hidden; border:1px solid var(--border); border-radius:var(--radius); background:var(--background); }
.simple-html-embed-header { border-bottom:1px solid var(--border); background:var(--muted); padding:.45rem .7rem; color:var(--muted-foreground); font:11px var(--font-mono,monospace); }
.simple-html-embed iframe { display:block; width:100%; border:0; background:white; }
.bb-docs-panel .tiptap { max-width: none; padding: 1rem 0 3rem; font-size: 14px; }
@media (max-width: 47.999rem) { .bb-simple-notes-editor .tiptap { padding-inline: 1.25rem; font-size: 16.875px; } }
`;

function ensureEditorStyles(): void {
  const existing = document.head.querySelector<HTMLStyleElement>(
    `[${STYLE_MARKER}]`,
  );
  if (existing) {
    existing.textContent = EDITOR_CSS;
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(STYLE_MARKER, "");
  style.textContent = EDITOR_CSS;
  document.head.append(style);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function TiptapEditor({
  initialValue,
  previewBaseUrl,
  notePath,
  onUpload,
  onFirstRender,
  onMarkdownChange,
  value,
  baseMarkdown = null,
  inline = false,
  disabled = false,
  onFocusChange,
}: {
  initialValue: string;
  previewBaseUrl: string;
  notePath: string;
  onUpload(file: File): Promise<{ markdownPath: string }>;
  onFirstRender(markdown: string): void;
  onMarkdownChange(markdown: string): void;
  value?: string;
  baseMarkdown?: string | null;
  inline?: boolean;
  disabled?: boolean;
  onFocusChange?(focused: boolean): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const baselineRef = useRef<ProseMirrorNode | null>(null);
  const sourceRef = useRef(initialValue);
  const valueRef = useRef(value);
  valueRef.current = value;
  const baseRef = useRef(baseMarkdown);
  baseRef.current = baseMarkdown;
  const focusRef = useRef(onFocusChange);
  focusRef.current = onFocusChange;
  const serializeRef = useRef<() => string>(() => "");
  const setBase = (editor: Editor) => {
    if (baseRef.current === null) baselineRef.current = null;
    else {
      const body = parseMarkdownDocument(baseRef.current).body;
      const root = new window.DOMParser().parseFromString(
        editor.storage.markdown.parser.parse(
          displayMarkdown(body, previewBaseUrl, notePath),
        ),
        "text/html",
      ).body;
      baselineRef.current = ProseMirrorDOMParser.fromSchema(
        editor.schema,
      ).parse(root);
    }
    editor.view.dispatch(
      editor.state.tr.setMeta(proposalDiffKey, { refresh: true }),
    );
  };
  const uploadRef = useRef(onUpload);
  uploadRef.current = onUpload;
  const firstRef = useRef(onFirstRender);
  firstRef.current = onFirstRender;
  const changeRef = useRef(onMarkdownChange);
  changeRef.current = onMarkdownChange;

  useEffect(() => {
    ensureEditorStyles();
    if (!rootRef.current) return;
    sourceRef.current = valueRef.current ?? initialValue;
    const markdownDocument = parseMarkdownDocument(sourceRef.current);
    let editor: Editor;
    const upload = async (file: File) => {
      if (!file.type.startsWith("image/")) return false;
      const result = await uploadRef.current(file);
      editor
        .chain()
        .focus()
        .setImage({
          src: previewUrl(previewBaseUrl, notePath, result.markdownPath),
          alt: file.name,
        })
        .run();
      return true;
    };
    editor = new Editor({
      element: rootRef.current,
      extensions: [
        StarterKit,
        createProposalDiff({ getBaseDocument: () => baselineRef.current }),
        Link.configure({ openOnClick: false, autolink: true }),
        Image.configure({ allowBase64: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true, lastColumnResizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        MarkdownTaskInput,
        HtmlEmbed.configure({ baseUrl: previewBaseUrl, notePath }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        Markdown.configure({
          html: true,
          tightLists: true,
          bulletListMarker: "-",
          linkify: true,
        }),
      ],
      content: displayMarkdown(markdownDocument.body, previewBaseUrl, notePath),
      autofocus: inline ? false : "end",
      editable: !disabled,
      onFocus: () => focusRef.current?.(true),
      onBlur: () => focusRef.current?.(false),
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Document content",
          "aria-multiline": "true",
        },
        handleKeyDown(view, event) {
          if (!inline || event.key !== "Escape") return false;
          view.dom.blur();
          return true;
        },
        handlePaste(_view, event) {
          const file = [...(event.clipboardData?.files ?? [])].find(
            (candidate) => candidate.type.startsWith("image/"),
          );
          if (!file) return false;
          void upload(file);
          return true;
        },
        handleDrop(_view, event) {
          const file = [...(event.dataTransfer?.files ?? [])].find(
            (candidate) => candidate.type.startsWith("image/"),
          );
          if (!file) return false;
          event.preventDefault();
          void upload(file);
          return true;
        },
      },
    });
    editorRef.current = editor;
    setBase(editor);
    const getMarkdown = () => {
      const current = parseMarkdownDocument(sourceRef.current);
      const leadingBreaks = current.frontmatter
        ? (/^(?:\r?\n)*/.exec(current.body)?.[0] ?? "")
        : "";
      return (
        current.frontmatter +
        leadingBreaks +
        storedMarkdown(
          editor.storage.markdown.getMarkdown(),
          previewBaseUrl,
          notePath,
        )
      );
    };
    serializeRef.current = getMarkdown;
    firstRef.current(getMarkdown());
    editor.on("update", () => changeRef.current(getMarkdown()));
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [initialValue, notePath, previewBaseUrl, inline]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === undefined) return;
    if (value !== sourceRef.current && value !== serializeRef.current()) {
      const { from, to } = editor.state.selection;
      const focused = editor.isFocused;
      editor.commands.setContent(
        displayMarkdown(
          parseMarkdownDocument(value).body,
          previewBaseUrl,
          notePath,
        ),
        false,
      );
      if (focused)
        editor.commands.setTextSelection({
          from: Math.min(from, editor.state.doc.content.size),
          to: Math.min(to, editor.state.doc.content.size),
        });
    }
    sourceRef.current = value;
  }, [value, notePath, previewBaseUrl]);
  useEffect(() => {
    if (editorRef.current) setBase(editorRef.current);
  }, [baseMarkdown]);
  useEffect(() => {
    editorRef.current?.setEditable(!disabled, false);
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      data-inline={inline}
      className="bb-simple-notes-editor min-h-0 flex-1 overflow-y-auto text-sm"
    />
  );
}

type DocsRpcClient = ReturnType<typeof useRpc<typeof docsRpcContract>>;

interface NotebookStore {
  consumers: Set<symbol>;
  data: NotesData | null;
  error: string | null;
  inFlight: Promise<void> | null;
  listeners: Set<() => void>;
  owner: symbol | null;
  pendingRefreshRpc: DocsRpcClient | null;
  requestId: number;
  vaultId: string | null;
}

const notebookStores = new Map<string | null, NotebookStore>();

function getNotebookStore(vaultId: string | null): NotebookStore {
  const existing = notebookStores.get(vaultId);
  if (existing) return existing;
  const store: NotebookStore = {
    consumers: new Set(),
    data: null,
    error: null,
    inFlight: null,
    listeners: new Set(),
    owner: null,
    pendingRefreshRpc: null,
    requestId: 0,
    vaultId,
  };
  notebookStores.set(vaultId, store);
  return store;
}

function notifyNotebookStore(store: NotebookStore): void {
  for (const listener of store.listeners) listener();
}

function refreshNotebookStore(
  store: NotebookStore,
  rpc: DocsRpcClient,
  { queueIfInFlight = true }: { queueIfInFlight?: boolean } = {},
): Promise<void> {
  if (notebookStores.get(store.vaultId) !== store) return Promise.resolve();
  if (store.inFlight) {
    if (queueIfInFlight) store.pendingRefreshRpc = rpc;
    return store.inFlight;
  }
  if (store.error !== null) {
    store.error = null;
    notifyNotebookStore(store);
  }
  const requestId = ++store.requestId;
  const request = rpc
    .call("listNotes", store.vaultId ? { vaultId: store.vaultId } : {})
    .then((value) => {
      if (
        requestId !== store.requestId ||
        notebookStores.get(store.vaultId) !== store
      )
        return;
      store.data = value;
      store.error = null;
      notifyNotebookStore(store);
    })
    .catch((error: unknown) => {
      if (
        requestId !== store.requestId ||
        notebookStores.get(store.vaultId) !== store
      )
        return;
      const message = errorMessage(error);
      if (store.data === null) store.error = message;
      else store.data = { ...store.data, error: message };
      notifyNotebookStore(store);
    })
    .finally(() => {
      if (store.inFlight !== request) return;
      store.inFlight = null;
      const pendingRefreshRpc = store.pendingRefreshRpc;
      store.pendingRefreshRpc = null;
      if (
        pendingRefreshRpc !== null &&
        store.consumers.size > 0 &&
        notebookStores.get(store.vaultId) === store
      ) {
        void refreshNotebookStore(store, pendingRefreshRpc, {
          queueIfInFlight: false,
        });
      }
    });
  store.inFlight = request;
  return request;
}

function useNotebook(vaultId: string | null) {
  const rpc = useRpc<typeof docsRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const store = useMemo(() => getNotebookStore(vaultId), [vaultId]);
  const consumerRef = useRef(Symbol("docs-notebook-consumer"));
  const [, rerender] = useState(0);
  const refresh = useCallback(() => {
    void refreshNotebookStore(store, rpcRef.current);
  }, [store]);

  useEffect(() => {
    const consumer = consumerRef.current;
    const listener = () => rerender((version) => version + 1);
    store.consumers.add(consumer);
    store.listeners.add(listener);
    store.owner ??= consumer;
    if (store.data === null) {
      void refreshNotebookStore(store, rpcRef.current, {
        queueIfInFlight: false,
      });
    }
    return () => {
      store.consumers.delete(consumer);
      store.listeners.delete(listener);
      if (store.owner === consumer)
        store.owner = store.consumers.values().next().value ?? null;
      if (store.consumers.size === 0) {
        queueMicrotask(() => {
          if (
            store.consumers.size !== 0 ||
            notebookStores.get(store.vaultId) !== store
          )
            return;
          store.requestId += 1;
          store.pendingRefreshRpc = null;
          notebookStores.delete(store.vaultId);
        });
      }
    };
  }, [store]);

  useRealtime(
    "vault-changed",
    useCallback(() => {
      if (store.owner === consumerRef.current) refresh();
    }, [refresh, store]),
  );

  const data =
    store.data && (vaultId === null || store.data.vault.id === vaultId)
      ? store.data
      : null;
  return { data, error: store.error, refresh };
}

function DocumentSkeleton() {
  return (
    <DelayedLoading>
      <div
        className="min-w-0 flex-1 overflow-hidden"
        role="status"
        aria-label="Loading document"
      >
        <span className="sr-only">Loading…</span>
        <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12">
          <div className="space-y-4">
            <Skeleton className="h-8 w-2/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="space-y-4 pt-2">
            <Skeleton className="h-6 w-1/3" />
            <div className="space-y-3">
              {["w-11/12", "w-4/5", "w-2/3"].map((width) => (
                <div className="flex items-center gap-3" key={width}>
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className={cn("h-4", width)} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DelayedLoading>
  );
}

interface DocumentRef {
  vaultId: string;
  path: string;
  title: string;
}

function documentTitle(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.(md|html?)$/i, "");
}

function parseDocumentRef(value: unknown): DocumentRef | null {
  if (!isRecord(value)) return null;
  const vaultId =
    typeof value.vaultId === "string"
      ? value.vaultId
      : typeof value.vault === "string"
        ? value.vault
        : "";
  const path = typeof value.path === "string" ? value.path : "";
  const title =
    typeof value.title === "string" && value.title.trim()
      ? value.title.trim()
      : documentTitle(path);
  if (
    !vaultId ||
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/\.(md|html?)$/i.test(path)
  )
    return null;
  return { vaultId, path, title };
}

function DocumentAction({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40"
          >
            <Icon name={icon} className="size-3" />
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InlineDocument({
  document,
  openInTab,
}: {
  document: DocumentRef;
  openInTab?(): void;
}) {
  const { state, session } = useDocumentSession(
    document.vaultId,
    document.path,
  );
  const rpc = useRpc<typeof docsRpcContract>();
  const composer = useComposer();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const content = contentRef.current;
    if (!openInTab || !content) return;
    const measure = () =>
      setTruncated(content.getBoundingClientRect().height > 400);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [state.loaded, openInTab]);
  const pending = state.proposal?.status === "pending" ? state.proposal : null;
  const stale = pending !== null && pending.baseSha256 !== state.sha256;
  const undo =
    state.proposal &&
    ((state.proposal.status === "accepted" &&
      state.proposal.resolvedSha256 === state.sha256) ||
      (state.proposal.status === "rejected" &&
        state.proposal.baseSha256 === state.sha256));
  const redo =
    state.proposal?.status === "undone" &&
    state.proposal.baseSha256 === state.sha256;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.draft);
      toast.success("Document copied");
    } catch {
      toast.error("Could not copy the document");
    }
  };
  const ask = async () => {
    setAsking(true);
    setAskError(null);
    try {
      await session.flush();
      composer.updateText(
        (current) => `${current}${current.trim() ? "\n\n" : ""}Update `,
      );
      composer.insertMention({
        provider: "note",
        id: `${document.vaultId}:${document.path}`,
        label: document.title,
      });
      composer.focus();
    } catch (error) {
      setAskError(errorMessage(error));
    } finally {
      setAsking(false);
    }
  };
  const baseMetadata = pending
    ? parseMarkdownDocument(pending.baseContent).frontmatter
    : "";
  const candidateMetadata = pending
    ? parseMarkdownDocument(state.draft).frontmatter
    : "";
  return (
    <TooltipProvider delayDuration={200}>
      <section
        aria-label={document.title}
        className="my-2 min-w-0 overflow-hidden rounded-lg border border-border bg-background"
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 font-semibold">Docs</span>
            <span className="truncate opacity-70">{document.title}</span>
          </div>
          {(state.busy || state.saving || asking) && (
            <span
              role="status"
              className="inline-flex size-5 shrink-0 items-center justify-center"
            >
              <Icon name="Loading" className="size-3 animate-spin" />
              <span className="sr-only">Updating document…</span>
            </span>
          )}
          <div
            className="flex shrink-0 items-center gap-0.5"
            role="group"
            aria-label="Document actions"
          >
            {pending && (
              <>
                <DocumentAction
                  label="Accept"
                  icon="Check"
                  disabled={state.busy || state.saving || stale}
                  onClick={() => void session.resolve("accept")}
                />
                <DocumentAction
                  label="Reject"
                  icon="X"
                  disabled={state.busy}
                  onClick={() => void session.resolve("reject")}
                />
              </>
            )}
            {undo && !state.dirty && (
              <DocumentAction
                label="Undo"
                icon="ArrowTurnBackward"
                disabled={state.busy}
                onClick={() => void session.resolve("undo")}
              />
            )}
            {redo && !state.dirty && (
              <DocumentAction
                label="Redo"
                icon="ArrowTurnForward"
                disabled={state.busy}
                onClick={() => void session.resolve("redo")}
              />
            )}
            <DocumentAction
              label="Ask for changes"
              icon="MessageSquare"
              disabled={!state.loaded || state.busy || asking}
              onClick={() => void ask()}
            />
            <DocumentAction
              label="Copy"
              icon="Copy"
              disabled={!state.loaded}
              onClick={() => void copy()}
            />
            {openInTab && (
              <>
                <span className="mx-1 h-4 border-l border-border" />
                <DocumentAction
                  label="Open in tab"
                  icon="ExternalLink"
                  onClick={openInTab}
                />
              </>
            )}
          </div>
        </header>
        {(state.error || askError) && (
          <div
            className="flex items-center gap-2 px-4 py-2 text-xs text-destructive"
            role="alert"
          >
            <span>{state.error || askError}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void (state.dirty ? session.flush() : session.refresh()).catch(
                  () => undefined,
                )
              }
            >
              Retry
            </Button>
          </div>
        )}
        {stale && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            This document changed. Ask for an updated proposal before accepting.
          </p>
        )}
        <div
          className="relative"
          style={openInTab ? { maxHeight: 400, overflow: "clip" } : undefined}
        >
          {!state.loaded ? (
            <DocumentSkeleton />
          ) : (
            <>
              <div
                ref={contentRef}
                data-editing={editing && !truncated}
                className="min-w-0 data-[editing=true]:bg-muted/10 data-[editing=true]:ring-1 data-[editing=true]:ring-inset data-[editing=true]:ring-ring/50"
              >
                {pending && baseMetadata !== candidateMetadata && (
                  <div className="px-6 pt-4 text-xs">
                    <p className="mb-2 font-medium">Document metadata</p>
                    {baseMetadata && (
                      <pre className="whitespace-pre-wrap bg-diff-removed/10 text-diff-removed">
                        <del>{baseMetadata}</del>
                      </pre>
                    )}
                    {candidateMetadata && (
                      <pre className="whitespace-pre-wrap bg-diff-added/10 text-diff-added">
                        {candidateMetadata}
                      </pre>
                    )}
                  </div>
                )}
                <TiptapEditor
                  initialValue=""
                  value={state.draft}
                  baseMarkdown={pending?.baseContent ?? null}
                  inline
                  disabled={state.busy || truncated}
                  previewBaseUrl={state.previewBaseUrl}
                  notePath={document.path}
                  onFocusChange={setEditing}
                  onFirstRender={() => undefined}
                  onMarkdownChange={session.edit}
                  onUpload={async (file) => {
                    const result = await rpc.call("uploadAttachment", {
                      vaultId: document.vaultId,
                      notePath: document.path,
                      name: file.name,
                      content: await fileToBase64(file),
                    });
                    return { markdownPath: result.markdownPath };
                  }}
                />
              </div>
              {truncated && openInTab && (
                <button
                  type="button"
                  aria-label={`Open ${document.title} in tab`}
                  className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={openInTab}
                >
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background via-background/95 to-transparent" />
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}

function DocsDirectiveCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const document = parseDocumentRef(attributes);
  if (!document) {
    return (
      <div className="my-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        Invalid Docs link. Expected a vault and a Markdown or HTML path.
      </div>
    );
  }
  const openInDocs = () =>
    navigate.toPluginPanel("docs", {
      subPath: `${document.vaultId}/${document.path}`,
    });
  const openPreview = () => {
    const opened = navigate.openThreadPanel({
      actionId: "document",
      title: document.title,
      params: {
        vaultId: document.vaultId,
        path: document.path,
        title: document.title,
      },
    });
    if (!opened) openInDocs();
  };
  if (!/\.html?$/i.test(document.path))
    return <InlineDocument document={document} openInTab={openPreview} />;
  return (
    <div className="my-3 flex h-11 items-center gap-1 rounded-lg border border-border bg-card px-2 shadow-sm transition-colors hover:bg-state-hover">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={openPreview}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <HugeiconsIcon
            icon={/\.html?$/i.test(document.path) ? HtmlFile01Icon : File01Icon}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {document.title}
        </span>
      </button>
      <Button
        className="size-8 shrink-0"
        size="icon"
        variant="ghost"
        aria-label="Open in Docs"
        onClick={openInDocs}
      >
        <HugeiconsIcon icon={ArrowUpRight01Icon} />
      </Button>
    </div>
  );
}

function HtmlDocumentPanelBody({ document }: { document: DocumentRef }) {
  const rpc = useRpc<typeof docsRpcContract>();
  const [state, setState] = useState<PreviewLease | { error: string } | null>(
    null,
  );
  useEffect(() => {
    let active = true;
    setState(null);
    rpc
      .call("preparePreview", {
        vaultId: document.vaultId,
        path: document.path,
      })
      .then((lease) => {
        if (active) setState(lease);
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            error: errorMessage(error),
          });
      });
    return () => {
      active = false;
    };
  }, [document.path, document.vaultId, rpc]);
  if (!state) return <DocumentSkeleton />;
  if ("error" in state)
    return <div className="text-sm text-destructive">{state.error}</div>;
  return (
    <iframe
      className="min-h-[32rem] flex-1 border-0 bg-white"
      sandbox="allow-scripts"
      title={document.title}
      src={`${state.baseUrl}/${encodePath(document.path)}`}
    />
  );
}

function DocumentPicker() {
  const [subPath, setSubPath] = useState("");
  const navigate = useBbNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Choose a document to open.
      </p>
      <NotesWorkspace
        subPath={subPath}
        navigationOnly
        onNavigate={(next) => {
          const [vaultId, ...parts] = next.split("/");
          const filePath = parts.join("/");
          if (vaultId && filePath) {
            const title = (filePath.split("/").pop() ?? filePath).replace(
              /\.(md|html?)$/i,
              "",
            );
            navigate.openThreadPanel({
              actionId: "document",
              title,
              params: { vaultId, path: filePath, title },
            });
          } else setSubPath(next);
        }}
      />
    </div>
  );
}

function DocumentPanel({ params }: PluginThreadPanelProps) {
  const document = parseDocumentRef(params);
  const navigate = useBbNavigate();
  if (!document) return <DocumentPicker />;
  if (!/\.html?$/i.test(document.path))
    return <InlineDocument document={document} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pb-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium">
          {document.title}
        </div>
        <Button
          className="size-8 shrink-0"
          size="icon"
          variant="ghost"
          aria-label="Open in Docs"
          onClick={() =>
            navigate.toPluginPanel("docs", {
              subPath: `${document.vaultId}/${document.path}`,
            })
          }
        >
          <HugeiconsIcon icon={ArrowUpRight01Icon} />
        </Button>
      </div>
      <HtmlDocumentPanelBody document={document} />
    </div>
  );
}

function SavedDocumentEditor({
  io,
  onUpload,
  onReload,
  errorHint = "",
}: {
  io: DocumentIO;
  onUpload(file: File): Promise<{ markdownPath: string }>;
  onReload?(): void;
  errorHint?: string;
}) {
  const { state, session } = useSavedDocument(io);
  if (!state.loaded)
    return state.error ? (
      <div className="min-w-0 flex-1 p-6 text-sm text-destructive">
        {state.error}
        {errorHint}
      </div>
    ) : (
      <DocumentSkeleton />
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {state.conflict && (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs">
          Changed on disk.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (onReload ? onReload() : void session.reload())}
          >
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void session.flush(true).catch(() => undefined)}
          >
            Overwrite
          </Button>
        </div>
      )}
      {state.error && !state.conflict && (
        <div className="border-b border-border px-4 py-2 text-xs text-destructive">
          {state.error}
        </div>
      )}
      <TiptapEditor
        initialValue={state.initialContent}
        value={state.draft}
        previewBaseUrl={state.previewBaseUrl}
        notePath={state.previewPath}
        onUpload={onUpload}
        onFirstRender={session.initialize}
        onMarkdownChange={session.edit}
      />
    </div>
  );
}

function NotePane({
  vaultId,
  notePath,
  onChanged,
  onRenamed,
}: {
  vaultId: string;
  notePath: string;
  onChanged(): void;
  onRenamed(path: string): void;
}) {
  const rpc = useRpc<typeof docsRpcContract>();
  const callbacks = useRef({ onChanged, onRenamed });
  callbacks.current = { onChanged, onRenamed };
  const { io, upload } = useMemo(() => {
    let path = notePath;
    const io: DocumentIO = {
      delay: 700,
      read: async () => {
        const [file, lease] = await Promise.all([
          rpc.call("readNote", { vaultId, path }),
          rpc.call("preparePreview", { vaultId, path }),
        ]);
        return {
          content: file.content,
          sha256: file.sha256,
          previewBaseUrl: lease.baseUrl,
          previewPath: path,
          proposal: null,
        };
      },
      write: (content, expectedSha256) =>
        rpc.call("saveNote", {
          vaultId,
          path,
          content,
          ...(expectedSha256 === null ? {} : { expectedSha256 }),
        }),
      afterSave: async () => {
        callbacks.current.onChanged();
        const renamed = await rpc.call("renameToTitle", { vaultId, path });
        if (renamed.path !== path) {
          path = renamed.path;
          callbacks.current.onRenamed(path);
        }
      },
    };
    const upload = async (file: File) => {
      const result = await rpc.call("uploadAttachment", {
        vaultId,
        notePath: path,
        name: file.name,
        content: await fileToBase64(file),
      });
      return { markdownPath: result.markdownPath };
    };
    return { io, upload };
  }, [rpc, vaultId, notePath]);
  return (
    <SavedDocumentEditor
      io={io}
      onUpload={upload}
      onReload={() => location.reload()}
    />
  );
}

function DocsFileOpener({ path: filePath, source }: PluginFileOpenerProps) {
  const rpc = useRpc<typeof docsRpcContract>();
  const navigate = useBbNavigate();
  const liveFileTarget = useMemo<ExperimentalLiveFileTarget | null>(() => {
    switch (source.kind) {
      case "workspace":
        return source.environmentId === null
          ? null
          : {
              kind: source.kind,
              environmentId: source.environmentId,
              path: filePath,
            };
      case "host":
        return source.experimental_hostId === undefined
          ? null
          : {
              kind: source.kind,
              hostId: source.experimental_hostId,
              path: filePath,
            };
      case "thread-storage":
        return source.threadId === null
          ? null
          : { kind: source.kind, threadId: source.threadId, path: filePath };
    }
  }, [filePath, source]);
  const openerSource = useMemo(
    () => ({
      kind: source.kind,
      threadId: source.threadId,
      environmentId: source.environmentId,
      projectId: source.projectId,
      ...(source.experimental_hostId === undefined
        ? {}
        : { experimental_hostId: source.experimental_hostId }),
    }),
    [
      source.environmentId,
      source.experimental_hostId,
      source.kind,
      source.projectId,
      source.threadId,
    ],
  );
  const io = useMemo<DocumentIO>(
    () => ({
      delay: 700,
      read: async () => {
        const { file, preview, previewPath } = await rpc.call("openFile", {
          source: openerSource,
          path: filePath,
        });
        return {
          content: file.content,
          sha256: file.sha256,
          previewBaseUrl: preview.baseUrl,
          previewPath,
          proposal: null,
        };
      },
      write: (content, expectedSha256) =>
        rpc.call("saveOpenedFile", {
          source: openerSource,
          path: filePath,
          content,
          ...(expectedSha256 === null ? {} : { expectedSha256 }),
        }),
    }),
    [rpc, openerSource, filePath],
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {liveFileTarget === null ? null : (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          <FileLink className="min-w-0 flex-1 truncate" target={liveFileTarget}>
            {filePath}
          </FileLink>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label="Open file externally"
            onClick={() =>
              navigate.experimental_openFileExternally({
                target: liveFileTarget,
                location: null,
              })
            }
          >
            <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" />
          </Button>
        </div>
      )}
      <SavedDocumentEditor
        io={io}
        errorHint=" — use the tab's Open with menu to choose another viewer."
        onUpload={async () => {
          throw new Error(
            "Add this file to a Docs vault before uploading images",
          );
        }}
      />
    </div>
  );
}

function HtmlPane({
  vaultId,
  filePath,
}: {
  vaultId: string;
  filePath: string;
}) {
  const rpc = useRpc<typeof docsRpcContract>();
  const [lease, setLease] = useState<PreviewLease | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLease(null);
    setError(null);
    void rpc
      .call("preparePreview", { vaultId, path: filePath })
      .then((value) => setLease(value))
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [filePath, rpc, vaultId]);
  if (error)
    return (
      <div className="min-w-0 flex-1 p-6 text-sm text-destructive">{error}</div>
    );
  if (!lease) return <DocumentSkeleton />;
  return (
    <iframe
      className="min-h-0 flex-1 border-0 bg-white"
      sandbox="allow-scripts"
      title={filePath}
      src={`${lease.baseUrl}/${encodePath(filePath)}`}
    />
  );
}

function orderEntries(
  entries: VaultEntry[],
  entryOrder: readonly string[],
): VaultEntry[] {
  const orderByPath = new Map(
    entryOrder.map((entryPath, index) => [entryPath, index]),
  );
  const children = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const parent = dirname(entry.path);
    const siblings = children.get(parent) ?? [];
    siblings.push(entry);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      if (left.kind === "file") {
        const leftOrder = orderByPath.get(left.path);
        const rightOrder = orderByPath.get(right.path);
        if (leftOrder !== undefined || rightOrder !== undefined) {
          if (leftOrder === undefined) return 1;
          if (rightOrder === undefined) return -1;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        }
      }
      const leftName = left.path.split("/").at(-1) ?? left.path;
      const rightName = right.path.split("/").at(-1) ?? right.path;
      return leftName.localeCompare(rightName, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }
  const ordered: VaultEntry[] = [];
  const visit = (parent: string) => {
    for (const entry of children.get(parent) ?? []) {
      ordered.push(entry);
      if (entry.kind === "directory") visit(entry.path);
    }
  };
  visit("");
  return ordered;
}

interface NotesSidebarNavigationProps {
  query: string;
  searchOpen: boolean;
  onQueryChange(value: string): void;
  onSearchOpenChange(open: boolean): void;
  onNewNote(): void;
  onNewFolder(): void;
}

function NotesSidebarNavigation(props: NotesSidebarNavigationProps) {
  return (
    <div
      role="toolbar"
      aria-label="Notes sidebar actions"
      className="flex min-w-0 flex-1 items-center gap-1"
    >
      {props.searchOpen ? (
        <>
          <div className="relative min-w-0 flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              className="h-8 pl-8"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                props.onQueryChange("");
                props.onSearchOpenChange(false);
              }}
              placeholder="Search this vault"
            />
          </div>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            aria-label="Close search"
            onClick={() => {
              props.onQueryChange("");
              props.onSearchOpenChange(false);
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
          </Button>
        </>
      ) : null}
      {!props.searchOpen ? (
        <>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            aria-label="Search notes"
            onClick={() => props.onSearchOpenChange(true)}
          >
            <HugeiconsIcon icon={Search01Icon} className="size-4" />
          </Button>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            aria-label="New note"
            onClick={props.onNewNote}
          >
            <HugeiconsIcon icon={FileAddIcon} className="size-4" />
          </Button>
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            aria-label="New folder"
            onClick={props.onNewFolder}
          >
            <HugeiconsIcon icon={FolderAddIcon} className="size-4" />
          </Button>
          <span className="min-w-0 flex-1" />
        </>
      ) : null}
    </div>
  );
}

function Tree({
  data,
  selectedPath,
  onOpen,
  onNewNote,
  onNewFolder,
  onDeleteFile,
  onReorderFiles,
  onMoveFile,
  onVaultChange,
  onAddVault,
}: {
  data: NotesData;
  selectedPath: string | null;
  onOpen(path: string): void;
  onNewNote(): void;
  onNewFolder(): void;
  onDeleteFile(path: string): void;
  onReorderFiles(parent: string, paths: string[]): void;
  onMoveFile(
    sourcePath: string,
    targetFolder: string,
    targetOrder?: string[],
  ): void;
  onVaultChange(vaultId: string): void;
  onAddVault(): void;
}) {
  const portalScopeProps = usePortalScopeProps();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const draggingPathRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    path: string;
    edge: "before" | "after";
  } | null>(null);
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);
  const notesByPath = useMemo(
    () => new Map(data.notes.map((note) => [note.path, note])),
    [data.notes],
  );
  const selectedHost = data.vault.hostId
    ? data.hosts.find((host) => host.id === data.vault.hostId)
    : null;
  const hostUnavailable = Boolean(
    data.vault.hostId && selectedHost?.status !== "connected",
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ordered = orderEntries(data.entries, data.entryOrder);
    const included = new Set<string>();
    if (needle) {
      for (const entry of ordered) {
        const note = notesByPath.get(entry.path);
        if (
          entry.path.toLowerCase().includes(needle) ||
          note?.title.toLowerCase().includes(needle) ||
          note?.preview.toLowerCase().includes(needle)
        ) {
          included.add(entry.path);
          const parents = entry.path.split("/").slice(0, -1);
          let parent = "";
          for (const part of parents) {
            parent = parent ? `${parent}/${part}` : part;
            included.add(parent);
          }
        }
      }
    }
    return ordered.filter((entry) => {
      if (needle) return included.has(entry.path);
      const parents = entry.path.split("/").slice(0, -1);
      let current = "";
      return !parents.some((part) => {
        current = current ? `${current}/${part}` : part;
        return collapsed.has(current);
      });
    });
  }, [collapsed, data.entries, data.entryOrder, notesByPath, query]);

  const acceptsFileDrag = (event: ReactDragEvent<HTMLButtonElement>) =>
    draggingPathRef.current !== null ||
    Array.from(event.dataTransfer.types).includes("text/plain");

  const clearDrag = () => {
    draggingPathRef.current = null;
    setDraggingPath(null);
    setDropTarget(null);
    setFolderDropTarget(null);
  };

  const dropEdge = (
    event: ReactDragEvent<HTMLButtonElement>,
  ): "before" | "after" => {
    const targetRect = event.currentTarget.getBoundingClientRect();
    return event.clientY < targetRect.top + targetRect.height / 2
      ? "before"
      : "after";
  };

  const reorderAtTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    targetPath: string,
  ) => {
    if (!acceptsFileDrag(event)) return;
    event.preventDefault();
    setDropTarget({ path: targetPath, edge: dropEdge(event) });
    setFolderDropTarget(null);
    event.dataTransfer.dropEffect = "move";
  };

  const dropAtTarget = (
    event: ReactDragEvent<HTMLButtonElement>,
    targetPath: string,
  ) => {
    event.preventDefault();
    const sourcePath =
      event.dataTransfer.getData("text/plain") || draggingPathRef.current;
    if (!sourcePath || sourcePath === targetPath) {
      setDropTarget(null);
      return;
    }
    const parent = dirname(targetPath);
    const edge = dropEdge(event);
    const siblings = orderEntries(data.entries, data.entryOrder)
      .filter(
        (entry) => entry.kind === "file" && dirname(entry.path) === parent,
      )
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath !== sourcePath);
    const targetIndex = siblings.indexOf(targetPath);
    if (targetIndex === -1) return;
    const fileName = sourcePath.split("/").at(-1) ?? sourcePath;
    const destinationPath = parent ? `${parent}/${fileName}` : fileName;
    siblings.splice(
      targetIndex + (edge === "after" ? 1 : 0),
      0,
      destinationPath,
    );
    if (dirname(sourcePath) === parent) {
      onReorderFiles(parent, siblings);
    } else {
      onMoveFile(sourcePath, parent, siblings);
    }
    clearDrag();
  };

  const moveIntoFolder = (
    event: ReactDragEvent<HTMLButtonElement>,
    targetFolder: string,
  ) => {
    event.preventDefault();
    const sourcePath =
      event.dataTransfer.getData("text/plain") || draggingPathRef.current;
    if (!sourcePath || dirname(sourcePath) === targetFolder) return;
    onMoveFile(sourcePath, targetFolder);
    clearDrag();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sidebar">
      <div className="relative flex items-center gap-1 p-2">
        <NotesSidebarNavigation
          query={query}
          searchOpen={searchOpen}
          onQueryChange={setQuery}
          onSearchOpenChange={setSearchOpen}
          onNewNote={onNewNote}
          onNewFolder={onNewFolder}
        />
        {draggingPath && dirname(draggingPath) ? (
          <button
            type="button"
            className={cn(
              "absolute inset-1 z-20 flex items-center gap-1.5 rounded-md border border-dashed border-border bg-popover px-2 text-left text-xs text-muted-foreground shadow-sm transition-colors",
              folderDropTarget === "" &&
                "border-primary/60 bg-state-active text-foreground",
            )}
            onDragOver={(event) => {
              if (!acceptsFileDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(null);
              setFolderDropTarget("");
            }}
            onDrop={(event) => moveIntoFolder(event, "")}
          >
            <HugeiconsIcon icon={Folder01Icon} className="size-4 shrink-0" />
            Move to top level
          </button>
        ) : null}
      </div>
      <nav
        aria-label="Notes"
        className="relative min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {data.error ? (
          <div className="p-3 text-xs text-destructive">{data.error}</div>
        ) : null}
        {visible.map((entry) => {
          const depth = entry.path.split("/").length - 1;
          const label =
            notesByPath.get(entry.path)?.title ??
            entry.path.split("/").at(-1) ??
            entry.path;
          const isFolder = entry.kind === "directory";
          const row = (
            <button
              type="button"
              draggable={!isFolder}
              onDragStart={(event) => {
                if (isFolder) return;
                draggingPathRef.current = entry.path;
                setDraggingPath(entry.path);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", entry.path);
              }}
              onDragOver={(event) => {
                if (!isFolder) {
                  reorderAtTarget(event, entry.path);
                  return;
                }
                if (acceptsFileDrag(event)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(null);
                  setFolderDropTarget(entry.path);
                }
              }}
              onDrop={(event) => {
                if (isFolder) moveIntoFolder(event, entry.path);
                else dropAtTarget(event, entry.path);
              }}
              onDragEnd={clearDrag}
              onClick={() => {
                if (isFolder)
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                else onOpen(entry.path);
              }}
              className={cn(
                "flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-state-hover",
                selectedPath === entry.path && "bg-state-active font-medium",
                draggingPath === entry.path && "opacity-50",
                folderDropTarget === entry.path &&
                  "bg-state-active ring-1 ring-inset ring-primary/50",
                dropTarget?.path === entry.path &&
                  dropTarget.edge === "before" &&
                  "relative before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full before:bg-primary",
                dropTarget?.path === entry.path &&
                  dropTarget.edge === "after" &&
                  "relative after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
              )}
              style={{ paddingLeft: `${8 + depth * 15}px` }}
            >
              {isFolder ? (
                <HugeiconsIcon
                  icon={
                    collapsed.has(entry.path)
                      ? ArrowRight01Icon
                      : ArrowDown01Icon
                  }
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <HugeiconsIcon
                icon={
                  isFolder
                    ? collapsed.has(entry.path)
                      ? Folder01Icon
                      : Folder02Icon
                    : /\.html?$/i.test(entry.path)
                      ? HtmlFile01Icon
                      : File01Icon
                }
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{label}</span>
            </button>
          );
          if (isFolder) {
            return <div key={`${entry.kind}:${entry.path}`}>{row}</div>;
          }
          return (
            <ContextMenuPrimitive.Root key={`${entry.kind}:${entry.path}`}>
              <ContextMenuPrimitive.Trigger asChild>
                {row}
              </ContextMenuPrimitive.Trigger>
              <ContextMenuPrimitive.Portal>
                <ContextMenuPrimitive.Content
                  {...portalScopeProps}
                  className="z-50 min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  <ContextMenuPrimitive.Item
                    className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive outline-none focus:bg-destructive/15 focus:text-destructive"
                    onSelect={() => onDeleteFile(entry.path)}
                  >
                    <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                    Delete
                  </ContextMenuPrimitive.Item>
                </ContextMenuPrimitive.Content>
              </ContextMenuPrimitive.Portal>
            </ContextMenuPrimitive.Root>
          );
        })}
        {data.truncated ? (
          <div className="p-2 text-xs text-muted-foreground">
            Tree truncated at 5,000 entries.
          </div>
        ) : null}
      </nav>
      <div className="grid gap-1.5 border-t border-border p-2">
        <div className="flex items-center gap-1">
          <Select value={data.vault.id} onValueChange={onVaultChange}>
            <SelectTrigger
              className="min-w-0 flex-1 border-transparent px-2 shadow-none hover:bg-state-hover"
              aria-label="Vault"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.vaults.map((vault) => (
                <SelectItem key={vault.id} value={vault.id}>
                  {vault.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="size-8 shrink-0"
            size="icon"
            variant="ghost"
            aria-label="Add vault"
            onClick={onAddVault}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
          </Button>
        </div>
        {hostUnavailable ? (
          <div
            className="flex items-center gap-1.5 px-1 text-xs text-destructive"
            role="status"
          >
            <HugeiconsIcon icon={AlertCircleIcon} className="size-4 shrink-0" />
            <span className="truncate">Host unavailable</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function parseRoute(subPath: string): {
  vaultId: string | null;
  filePath: string | null;
} {
  if (!subPath) return { vaultId: null, filePath: null };
  const parts = subPath.split("/").map(decodeURIComponent);
  if (parts.length === 1 && /\.(md|html?)$/i.test(parts[0] ?? "")) {
    return { vaultId: null, filePath: parts[0] ?? null };
  }
  return {
    vaultId: parts.shift() ?? null,
    filePath: parts.length ? parts.join("/") : null,
  };
}

function NotesWorkspace({
  subPath,
  navigationOnly,
  onNavigate,
}: PluginNavPanelProps & {
  navigationOnly: boolean;
  onNavigate?(subPath: string, replace?: boolean): void;
}) {
  const rpc = useRpc<typeof docsRpcContract>();
  const navigate = useBbNavigate();
  const navigateTo = useCallback(
    (next: string, replace?: boolean) => {
      if (onNavigate) onNavigate(next, replace);
      else
        navigate.toPluginPanel("docs", {
          subPath: next,
          ...(replace === undefined ? {} : { replace }),
        });
    },
    [navigate, onNavigate],
  );
  const route = parseRoute(subPath);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [vaultName, setVaultName] = useState("");
  const [vaultRootPath, setVaultRootPath] = useState("");
  const [vaultHostId, setVaultHostId] = useState("primary");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const { data, error, refresh } = useNotebook(route.vaultId);
  const activeVaultId = data?.vault.id ?? route.vaultId;
  const filePath = route.filePath;
  const currentVaultIdRef = useRef(activeVaultId);
  currentVaultIdRef.current = activeVaultId;
  const isCurrentVault = useCallback(
    (vaultId: string) => currentVaultIdRef.current === vaultId,
    [],
  );

  const open = useCallback(
    (path: string, replace = false) => {
      if (!activeVaultId || !isCurrentVault(activeVaultId)) return;
      navigateTo(`${activeVaultId}/${path}`, replace);
    },
    [activeVaultId, isCurrentVault, navigateTo],
  );

  if (!data || !activeVaultId) {
    if (error)
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <p className="text-destructive">Could not load vaults: {error}</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      );
    return (
      <DelayedLoading>
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
          role="status"
        >
          Loading vaults…
        </div>
      </DelayedLoading>
    );
  }

  const selectedFolder = filePath ? dirname(filePath) : "";
  const newNote = () =>
    void rpc
      .call("createNote", {
        vaultId: activeVaultId,
        parent: selectedFolder,
        name: "Untitled",
      })
      .then((value) => {
        if (isCurrentVault(activeVaultId)) {
          refresh();
          open(value.path);
        }
      });
  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    setFolderError(null);
    const target = selectedFolder ? `${selectedFolder}/${name}` : name;
    try {
      await rpc.call("createFolder", { vaultId: activeVaultId, path: target });
      if (!isCurrentVault(activeVaultId)) return;
      setFolderName("");
      setFolderDialogOpen(false);
      refresh();
    } catch (error) {
      setFolderError(errorMessage(error));
    }
  };

  const createVault = async () => {
    const name = vaultName.trim();
    const rootPath = vaultRootPath.trim();
    if (!name || !rootPath) return;
    setVaultError(null);
    try {
      const value = await rpc.call("createVault", {
        name,
        rootPath,
        ...(vaultHostId === "primary" ? {} : { hostId: vaultHostId }),
      });
      if (!isCurrentVault(activeVaultId)) return;
      setVaultName("");
      setVaultRootPath("");
      setVaultHostId("primary");
      setVaultDialogOpen(false);
      navigateTo(value.id);
    } catch (error) {
      setVaultError(errorMessage(error));
    }
  };

  const deleteFile = async (path: string) => {
    try {
      await rpc.call("deletePath", {
        vaultId: activeVaultId,
        path,
      });
      if (!isCurrentVault(activeVaultId)) return;
      refresh();
      if (filePath === path) {
        navigateTo(activeVaultId, true);
      }
      toast.success(`Deleted ${path}`);
    } catch (error) {
      toast.error(`Could not delete ${path}: ${errorMessage(error)}`);
    }
  };

  const reorderFiles = async (parent: string, paths: string[]) => {
    try {
      await rpc.call("reorderFiles", {
        vaultId: activeVaultId,
        parent,
        paths,
      });
      if (!isCurrentVault(activeVaultId)) return;
      refresh();
    } catch (error) {
      toast.error(`Could not reorder files: ${errorMessage(error)}`);
    }
  };

  const moveFile = async (
    sourcePath: string,
    targetFolder: string,
    targetOrder?: string[],
  ) => {
    const fileName = sourcePath.split("/").at(-1) ?? sourcePath;
    const destinationPath = targetFolder
      ? `${targetFolder}/${fileName}`
      : fileName;
    try {
      let orderPreserved = true;
      await rpc.call("movePath", {
        vaultId: activeVaultId,
        from: sourcePath,
        to: destinationPath,
      });
      if (targetOrder) {
        try {
          await rpc.call("reorderFiles", {
            vaultId: activeVaultId,
            parent: targetFolder,
            paths: targetOrder,
          });
        } catch (error) {
          orderPreserved = false;
          toast.error(
            `Moved ${fileName}, but could not preserve its drop position: ${errorMessage(error)}`,
          );
        }
      }
      if (!isCurrentVault(activeVaultId)) return;
      refresh();
      if (filePath === sourcePath) open(destinationPath, true);
      if (orderPreserved) {
        toast.success(
          targetFolder
            ? `Moved ${fileName} to ${targetFolder}`
            : `Moved ${fileName} to the top level`,
        );
      }
    } catch (error) {
      toast.error(`Could not move ${fileName}: ${errorMessage(error)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {navigationOnly ? (
          <Tree
            data={data}
            selectedPath={filePath}
            onOpen={open}
            onNewNote={newNote}
            onNewFolder={() => setFolderDialogOpen(true)}
            onDeleteFile={(path) => void deleteFile(path)}
            onReorderFiles={(parent, paths) => void reorderFiles(parent, paths)}
            onMoveFile={(sourcePath, targetFolder, targetOrder) =>
              void moveFile(sourcePath, targetFolder, targetOrder)
            }
            onVaultChange={(value) => navigateTo(value)}
            onAddVault={() => setVaultDialogOpen(true)}
          />
        ) : filePath && /\.md$/i.test(filePath) ? (
          <NotePane
            key={`${activeVaultId}:${filePath}`}
            vaultId={activeVaultId}
            notePath={filePath}
            onChanged={refresh}
            onRenamed={(next) => {
              refresh();
              open(next, true);
            }}
          />
        ) : filePath && /\.html?$/i.test(filePath) ? (
          <HtmlPane
            key={`${activeVaultId}:${filePath}`}
            vaultId={activeVaultId}
            filePath={filePath}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>Select a note or HTML page.</p>
            <Button size="sm" variant="outline" onClick={newNote}>
              New note
            </Button>
          </div>
        )}
      </div>
      {navigationOnly ? (
        <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
          <DialogContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void createFolder();
              }}
            >
              <DialogHeader>
                <DialogTitle>New folder</DialogTitle>
                <DialogDescription>
                  Create it{" "}
                  {selectedFolder
                    ? `inside ${selectedFolder}`
                    : "at the vault root"}
                  .
                </DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-sm font-medium">
                Folder name
                <Input
                  autoFocus
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Projects"
                />
              </label>
              {folderError ? (
                <p className="text-xs text-destructive">{folderError}</p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setFolderDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!folderName.trim()}>
                  Create folder
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      {navigationOnly ? (
        <Dialog open={vaultDialogOpen} onOpenChange={setVaultDialogOpen}>
          <DialogContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void createVault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Add vault</DialogTitle>
                <DialogDescription>
                  Open a notes folder from this machine or a connected host.
                </DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5 text-sm font-medium">
                Name
                <Input
                  autoFocus
                  value={vaultName}
                  onChange={(event) => setVaultName(event.target.value)}
                  placeholder="Personal"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Folder path
                <Input
                  value={vaultRootPath}
                  onChange={(event) => setVaultRootPath(event.target.value)}
                  placeholder="/Users/me/Notes"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Host
                <Select value={vaultHostId} onValueChange={setVaultHostId}>
                  <SelectTrigger aria-label="Vault host">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Server machine</SelectItem>
                    {data.hosts.map((host) => (
                      <SelectItem key={host.id} value={host.id}>
                        {host.name} · {host.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {vaultError ? (
                <p className="text-xs text-destructive">{vaultError}</p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setVaultDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!vaultName.trim() || !vaultRootPath.trim()}
                >
                  Add vault
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function NotesPanel(props: PluginNavPanelProps) {
  return <NotesWorkspace {...props} navigationOnly={false} />;
}

function NotesNavigationPanel(props: PluginNavPanelProps) {
  return <NotesWorkspace {...props} navigationOnly />;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "docs",
    title: "Docs",
    icon: "FileText",
    path: "docs",
    component: NotesPanel,
    fixedTabs: [
      {
        panelId: "docs",
        id: "navigation",
        title: "Navigation",
        icon: "ListView",
        component: NotesNavigationPanel,
        layout: "flush",
      },
    ],
  });
  app.slots.threadPanelAction({
    id: "document",
    title: "Document",
    icon: "FileText",
    component: DocumentPanel,
  });
  app.slots.fileOpener({
    id: "docs",
    title: "Markdown",
    extensions: ["md", "mdx", "markdown"],
    component: DocsFileOpener,
  });
  app.slots.messageDirective({ id: "docs", component: DocsDirectiveCard });
});
