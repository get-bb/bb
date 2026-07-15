import { useEffect, useRef, useState } from "react";
import { Editor, type ChainedCommands } from "@tiptap/core";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckListIcon,
  Heading02Icon,
  LeftToRightBlockQuoteIcon,
  LeftToRightListBulletIcon,
  SourceCodeIcon,
  TextBoldIcon,
  TextItalicIcon,
} from "@hugeicons/core-free-icons";
import type { SuggestionProps } from "@tiptap/suggestion";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  createEditorExtensions,
  type MentionItem,
  type MentionSuggestionHandle,
} from "./extensions.js";

const STYLE_MARKER = "data-bb-tasks-editor-styles";
const EDITOR_CSS = `
.bb-tasks-editor .tiptap {
  outline: none; width: 100%; font-size: 14px; line-height: 1.65;
  color: var(--foreground); caret-color: var(--foreground);
  overflow-wrap: break-word; -webkit-font-smoothing: antialiased;
}
.bb-tasks-editor[data-variant="comment"] .tiptap { font-size: 13px; line-height: 1.55; }
.bb-tasks-editor .tiptap > :first-child,
.bb-tasks-editor .tiptap li > :first-child,
.bb-tasks-editor .tiptap blockquote > :first-child { margin-top: 0; }
.bb-tasks-editor .tiptap p { margin: 0.75em 0 0; }
.bb-tasks-editor[data-variant="comment"] .tiptap p { margin: 0.5em 0 0; }
.bb-tasks-editor .tiptap h1,
.bb-tasks-editor .tiptap h2,
.bb-tasks-editor .tiptap h3,
.bb-tasks-editor .tiptap h4,
.bb-tasks-editor .tiptap h5,
.bb-tasks-editor .tiptap h6 { margin: 1.25em 0 0; color: var(--foreground); font-weight: 600; }
.bb-tasks-editor .tiptap h1 { font-size: 1.45em; line-height: 1.3; }
.bb-tasks-editor .tiptap h2 { font-size: 1.2em; line-height: 1.4; }
.bb-tasks-editor .tiptap h3 { font-size: 1.08em; line-height: 1.45; }
.bb-tasks-editor .tiptap :is(h1, h2, h3, h4, h5, h6) + * { margin-top: 0.5em; }
.bb-tasks-editor .tiptap ul, .bb-tasks-editor .tiptap ol { margin: 0.75em 0 0; padding-left: 1.5em; }
.bb-tasks-editor .tiptap ul { list-style: disc; }
.bb-tasks-editor .tiptap ol { list-style: decimal; }
.bb-tasks-editor .tiptap li { margin-top: 0.3em; padding-left: 0.3em; }
.bb-tasks-editor .tiptap li > p, .bb-tasks-editor .tiptap li > ul, .bb-tasks-editor .tiptap li > ol { margin-top: 0.3em; }
.bb-tasks-editor .tiptap li::marker { color: var(--muted-foreground); }
.bb-tasks-editor .tiptap a { color: inherit; font-weight: 500; text-decoration: underline; text-decoration-color: color-mix(in oklab, currentColor 30%, transparent); cursor: pointer; }
.bb-tasks-editor .tiptap a:hover { text-decoration-color: currentColor; }
.bb-tasks-editor .tiptap strong { font-weight: 600; }
.bb-tasks-editor .tiptap code { background: var(--muted); border-radius: min(calc(var(--radius) * 0.6), 0.35em); padding: 0.125em 0.3em; font-size: 0.85em; font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
.bb-tasks-editor .tiptap pre { background: var(--muted); border-radius: var(--radius); padding: 0.65em 0.85em; overflow-x: auto; font-size: 0.875em; line-height: 1.5; margin: 0.9em 0 0; tab-size: 2; }
.bb-tasks-editor .tiptap pre code { background: none; padding: 0; font-size: inherit; }
.bb-tasks-editor .tiptap blockquote { border-left: 2px solid var(--border); padding-left: 0.85em; margin: 0.75em 0 0; color: var(--muted-foreground); }
.bb-tasks-editor .tiptap hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0 0; }
.bb-tasks-editor .tiptap img { display: block; max-width: 100%; max-height: 24rem; margin: 0.9em 0 0; border-radius: var(--radius); border: 1px solid var(--border); }
.bb-tasks-editor .tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] ul[data-type="taskList"] { margin-top: 0; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; margin-top: 0.3em; padding-left: 0; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] li > label { flex: 0 0 auto; display: inline-flex; align-items: center; height: 1.6em; user-select: none; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] li > div > p:first-child { margin-top: 0; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] input[type="checkbox"] { display: block; width: 14px; height: 14px; accent-color: var(--primary); cursor: pointer; margin: 0; }
.bb-tasks-editor .tiptap ul[data-type="taskList"] li[data-checked="true"] > div { color: var(--muted-foreground); text-decoration: line-through; }
.bb-tasks-editor .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--muted-foreground); }
.bb-tasks-editor .tiptap ::selection { background: color-mix(in oklab, var(--primary) 22%, transparent); }
.bb-tasks-editor .bb-tasks-mention {
  display: inline; border-radius: calc(var(--radius) * 0.75);
  background: color-mix(in oklab, var(--primary) 12%, transparent);
  color: var(--primary); padding: 0.05em 0.35em;
  font-size: 0.9em; font-weight: 500; white-space: nowrap;
}
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

interface MentionPopoverState {
  items: MentionItem[];
  clientRect: (() => DOMRect | null) | null;
  command: (item: MentionItem) => void;
  selectedIndex: number;
}

interface ToolbarAction {
  id: string;
  label: string;
  icon: IconSvgElement;
  isActive(editor: Editor): boolean;
  run(chain: ChainedCommands): ChainedCommands;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    id: "bold",
    label: "Bold",
    icon: TextBoldIcon,
    isActive: (editor) => editor.isActive("bold"),
    run: (chain) => chain.toggleBold(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: TextItalicIcon,
    isActive: (editor) => editor.isActive("italic"),
    run: (chain) => chain.toggleItalic(),
  },
  {
    id: "heading",
    label: "Heading",
    icon: Heading02Icon,
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    run: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    id: "bulletList",
    label: "Bullet list",
    icon: LeftToRightListBulletIcon,
    isActive: (editor) => editor.isActive("bulletList"),
    run: (chain) => chain.toggleBulletList(),
  },
  {
    id: "taskList",
    label: "Checklist",
    icon: CheckListIcon,
    isActive: (editor) => editor.isActive("taskList"),
    run: (chain) => chain.toggleTaskList(),
  },
  {
    id: "codeBlock",
    label: "Code block",
    icon: SourceCodeIcon,
    isActive: (editor) => editor.isActive("codeBlock"),
    run: (chain) => chain.toggleCodeBlock(),
  },
  {
    id: "blockquote",
    label: "Quote",
    icon: LeftToRightBlockQuoteIcon,
    isActive: (editor) => editor.isActive("blockquote"),
    run: (chain) => chain.toggleBlockquote(),
  },
];

export interface TasksEditorProps {
  /** Markdown source; the canonical representation of the content. */
  value: string;
  onChange(markdown: string): void;
  placeholder?: string;
  readOnly?: boolean;
  autofocus?: boolean;
  variant?: "doc" | "comment";
  onUploadImage?: (
    file: File,
  ) => Promise<{ url: string; attachmentId: string }>;
  mentionItems?: (
    query: string,
  ) => Promise<Array<{ id: string; key: string; title: string }>>;
  onEditorReady?: (editor: Editor) => void;
  className?: string;
}

export function TasksEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  autofocus = false,
  variant = "doc",
  onUploadImage,
  mentionItems,
  onEditorReady,
  className,
}: TasksEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const lastMarkdownRef = useRef(value);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const uploadRef = useRef(onUploadImage);
  uploadRef.current = onUploadImage;
  const mentionItemsRef = useRef(mentionItems);
  mentionItemsRef.current = mentionItems;
  const readyRef = useRef(onEditorReady);
  readyRef.current = onEditorReady;
  const initialValueRef = useRef(value);
  const autofocusRef = useRef(autofocus);

  const [focused, setFocused] = useState(false);
  const [, setRevision] = useState(0);
  const [mention, setMentionState] = useState<MentionPopoverState | null>(
    null,
  );
  const mentionRef = useRef<MentionPopoverState | null>(null);
  const setMention = (next: MentionPopoverState | null) => {
    mentionRef.current = next;
    setMentionState(next);
  };
  const setMentionRef = useRef(setMention);
  setMentionRef.current = setMention;

  useEffect(() => {
    ensureEditorStyles();
    if (!rootRef.current) return;
    let editor: Editor;
    const upload = async (file: File) => {
      const handler = uploadRef.current;
      if (!handler || !file.type.startsWith("image/")) return false;
      const result = await handler(file);
      editor
        .chain()
        .focus()
        .setImage({ src: result.url, alt: file.name })
        .run();
      return true;
    };
    const mentionHandle: MentionSuggestionHandle = {
      getItems: (query) =>
        mentionItemsRef.current?.(query) ?? Promise.resolve([]),
      onChange: (props: SuggestionProps<MentionItem, MentionItem>) => {
        const previous = mentionRef.current;
        setMentionRef.current({
          items: props.items,
          clientRect: props.clientRect ?? null,
          command: props.command,
          selectedIndex: Math.min(
            previous?.selectedIndex ?? 0,
            Math.max(0, props.items.length - 1),
          ),
        });
      },
      onExit: () => setMentionRef.current(null),
      onKeyDown: (event) => {
        const state = mentionRef.current;
        if (!state || state.items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setMentionRef.current({
            ...state,
            selectedIndex: (state.selectedIndex + 1) % state.items.length,
          });
          return true;
        }
        if (event.key === "ArrowUp") {
          setMentionRef.current({
            ...state,
            selectedIndex:
              (state.selectedIndex - 1 + state.items.length) %
              state.items.length,
          });
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = state.items[state.selectedIndex];
          if (item) state.command(item);
          return true;
        }
        if (event.key === "Escape") {
          setMentionRef.current(null);
          return true;
        }
        return false;
      },
    };
    editor = new Editor({
      element: rootRef.current,
      editable: !readOnly,
      extensions: createEditorExtensions({
        placeholder: () => placeholderRef.current ?? "",
        mentionHandle,
      }),
      content: initialValueRef.current,
      autofocus: autofocusRef.current && !readOnly ? "end" : false,
      editorProps: {
        handlePaste(_view, event) {
          if (!uploadRef.current) return false;
          const file = [...(event.clipboardData?.files ?? [])].find(
            (candidate) => candidate.type.startsWith("image/"),
          );
          if (!file) return false;
          void upload(file);
          return true;
        },
        handleDrop(_view, event) {
          if (!uploadRef.current) return false;
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
    editor.on("update", () => {
      const markdown = editor.storage.markdown.getMarkdown() as string;
      lastMarkdownRef.current = markdown;
      changeRef.current(markdown);
    });
    editor.on("focus", () => setFocused(true));
    editor.on("blur", () => setFocused(false));
    editor.on("transaction", () => setRevision((current) => current + 1));
    readyRef.current?.(editor);
    return () => {
      editorRef.current = null;
      setMentionRef.current(null);
      editor.destroy();
    };
  }, [readOnly]);

  // The value prop is canonical: when the host swaps in different markdown
  // (e.g. another task was opened), replace the document. Echoes of our own
  // onChange output are ignored.
  useEffect(() => {
    initialValueRef.current = value;
    const editor = editorRef.current;
    if (!editor || value === lastMarkdownRef.current) return;
    lastMarkdownRef.current = value;
    editor.commands.setContent(value, false);
  }, [value]);

  const editor = editorRef.current;
  const mentionRect = mention?.clientRect?.() ?? null;
  const toolbarVisible = !readOnly && focused;

  return (
    <div
      className={cn("bb-tasks-editor relative min-w-0", className)}
      data-variant={variant}
    >
      {readOnly ? null : (
        <TooltipProvider delayDuration={400}>
          <div
            role="toolbar"
            aria-label="Formatting"
            aria-hidden={!toolbarVisible}
            className={cn(
              "mb-1 flex w-fit items-center gap-0.5 rounded-md border border-border bg-background p-0.5 shadow-sm transition-opacity",
              toolbarVisible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {TOOLBAR_ACTIONS.map((action) => (
              <Tooltip key={action.id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={action.label}
                    aria-pressed={editor ? action.isActive(editor) : false}
                    tabIndex={toolbarVisible ? 0 : -1}
                    className={cn(
                      "size-7 text-muted-foreground",
                      editor && action.isActive(editor)
                        ? "bg-accent text-accent-foreground"
                        : undefined,
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const current = editorRef.current;
                      if (!current) return;
                      action.run(current.chain().focus()).run();
                    }}
                  >
                    <HugeiconsIcon icon={action.icon} className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{action.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}
      <div ref={rootRef} className="min-w-0" />
      {mention && mention.items.length > 0 ? (
        <div
          role="listbox"
          aria-label="Mention a task"
          className="fixed z-50 max-h-64 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={
            mentionRect
              ? { top: mentionRect.bottom + 4, left: mentionRect.left }
              : undefined
          }
        >
          {mention.items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === mention.selectedIndex}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                index === mention.selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => mention.command(item)}
            >
              <span className="shrink-0 font-medium text-muted-foreground">
                {item.key}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
