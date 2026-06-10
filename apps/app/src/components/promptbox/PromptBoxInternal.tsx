import { atom, useAtom } from "jotai";
import { RESET, atomWithStorage } from "jotai/utils";
import type { PromptTextMention } from "@bb/domain";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  useEditor,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import type {
  MentionMenuState,
  PromptMentionSuggestion,
} from "@/components/promptbox/mentions/types";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_COMBO_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import {
  arePromptDraftStatesEqual,
  isPromptDraftEmpty,
  type PromptDraftAttachment,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import { cn } from "@/lib/utils";
import { AttachmentPreview } from "./AttachmentPreview";
import {
  PromptMentionLinkContext,
  type PromptMentionLinkResolver,
} from "./editor/prompt-mention-link";
import { PromptMentionExtension } from "./editor/prompt-mention-extension";
import {
  promptEditorContentFromValue,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
  promptMentionResourceFromSuggestion,
  type PromptEditorValue,
} from "./editor/prompt-editor-serialization";
import { MentionMenu } from "./mentions/MentionMenu";
import { parsePromptMentionClipboardElement } from "./mentions/prompt-mention-clipboard";

const PROMPTBOX_MIN_HEIGHT = 68;
const PROMPTBOX_SELECTION_REVEAL_MARGIN = 12;
const RICH_PASTE_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DD",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
]);
const RICH_PASTE_IGNORED_TAGS = new Set([
  "HEAD",
  "LINK",
  "META",
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TITLE",
]);

type ZenModeLayout = "thread" | "root-compose";

const ZEN_MODE_STORAGE_KEY: Record<ZenModeLayout, string> = {
  thread: "bb.promptbox.zen-mode.thread",
  "root-compose": "bb.promptbox.zen-mode.root-compose",
};

const ZEN_MODE_HEIGHT_CLASS: Record<ZenModeLayout, string> = {
  thread: "h-[50dvh]",
  "root-compose": "h-[70dvh]",
};

const PROMPTBOX_MAX_HEIGHT_BY_LAYOUT: Record<ZenModeLayout, string> = {
  thread: "50dvh",
  "root-compose": "70dvh",
};

export interface PromptBoxSubmissionConfig {
  isSubmitting?: boolean;
  disabled?: boolean;
  title?: string;
  isRunning?: boolean;
  onStop?: () => void;
  onModifierSubmit?: () => void;
  /** When true, the submit button is enabled even when the textarea is
   * empty and no attachments are present. Used by callers (e.g. the
   * new-thread flow) where empty submission has a meaningful fallback
   * server-side. */
  allowEmptyInput?: boolean;
}

export interface MentionsConfig {
  suggestions: readonly PromptMentionSuggestion[];
  isLoading: boolean;
  isError: boolean;
  /** Called whenever the active @-mention query changes; null when no mention is active. */
  onQueryChange: (query: string | null) => void;
  /**
   * Resolves the click action for an inserted mention pill (navigate to a
   * thread, open a file preview). Omit to render pills as non-interactive
   * text; returns null per-resource when that mention isn't openable here.
   */
  resolveLink?: PromptMentionLinkResolver;
}

export interface AttachmentsConfig {
  items?: PromptDraftAttachment[];
  isAttaching?: boolean;
  error?: string | null;
  onAttachFiles?: (files: File[]) => void | Promise<void>;
  onRemove?: (path: string) => void;
  projectId?: string;
}

export interface PromptBoxZenModeConfig {
  layout?: ZenModeLayout;
  storageKey?: string | null;
  resetKey?: string | number;
  resetOnSubmit?: boolean;
}

export interface HistoryConfig {
  currentDraft: PromptDraftState;
  entries: readonly PromptDraftState[];
  onSelectEntry: (draft: PromptDraftState) => void;
  resetKey?: string | number;
}

export type PromptVoiceState = "idle" | "recording" | "transcribing" | "error";

export interface PromptVoiceConfig {
  state: PromptVoiceState;
  isSupported: boolean;
  start: () => void | Promise<void>;
  stop: () => void;
  cancel: () => void;
}

export interface PromptBoxHandle {
  /** Focus the editor and move the caret to the end. */
  focusEnd: () => void;
  /** Insert text at the editor's current cursor position, with smart spacing. */
  insertTextAtCursor: (text: string) => void;
  /** Return the trimmed text before the cursor, used as voice transcript context. */
  getTextBeforeCursor: () => string | undefined;
}

export type MentionMenuPlacement = "top" | "bottom";

export interface PromptBoxInternalProps {
  id?: string;
  value: string;
  mentionRanges: readonly PromptTextMention[];
  onChange: (value: string, mentionRanges: PromptTextMention[]) => void;
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
  /** Content rendered inside the prompt box card, above the text area. Use
   * for prominent context that should be impossible to miss — e.g. a
   * "Reusing existing worktree" banner when env mode is set to reuse. */
  header?: ReactNode;
  footerStart?: ReactNode;
  autoFocus?: boolean;
  submission?: PromptBoxSubmissionConfig;
  /**
   * Minimum textarea height in pixels. Defaults to PROMPTBOX_MIN_HEIGHT.
   * Callers may pass a smaller value to make room for siblings that grow
   * above the textarea (see FollowUpPromptBox's elastic compensation for
   * the context banner stack) — total prompt-area height stays constant.
   */
  minHeight?: number;
  mentions: MentionsConfig;
  /**
   * Where the @-mention menu floats relative to the prompt box.
   * "top" floats it above (used by FollowUp where the prompt sits at the
   * bottom of the thread), "bottom" floats it below (used by NewThread
   * where the prompt sits at the top of the project view).
   */
  mentionMenuPlacement: MentionMenuPlacement;
  attachments?: AttachmentsConfig;
  zenMode?: PromptBoxZenModeConfig;
  history?: HistoryConfig;
  /** When omitted, the mic button is hidden. Wrappers wire this via usePromptVoice. */
  voice?: PromptVoiceConfig;
  promptBoxRef?: Ref<PromptBoxHandle>;
}

interface DismissedMentionRange {
  start: number;
  end: number;
  hasLeftRange: boolean;
}

interface ActiveEditorMention {
  query: string;
  from: number;
  to: number;
}

interface PromptEditorValueKey {
  text: string;
  mentions: readonly PromptTextMention[];
}

const EDITOR_MENTION_PATTERN = /(^|[\s([{])@([^\s@]*)$/u;

interface PromptEditorSelectionRevealArgs {
  editor: Editor;
  scrollContainer: HTMLElement;
}

interface ParsedRichClipboardValue {
  hasMentions: boolean;
  value: PromptEditorValue;
}

type ZenModeUpdate =
  | boolean
  | typeof RESET
  | ((previous: boolean) => boolean | typeof RESET);

type PromptBoxMouseDownEvent = ReactMouseEvent<HTMLFormElement>;

const PROMPTBOX_INTERACTIVE_TARGET_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[data-prompt-mention='true']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
].join(",");

function createTransientZenModeAtom() {
  const baseAtom = atom(false);
  return atom(
    (get) => get(baseAtom),
    (get, set, update: ZenModeUpdate) => {
      const currentValue = get(baseAtom);
      const nextValue =
        typeof update === "function" ? update(currentValue) : update;

      set(baseAtom, nextValue === RESET ? false : nextValue);
    },
  );
}

function promptEditorValueKey(value: PromptEditorValueKey): string {
  return JSON.stringify(value);
}

function normalizePastedPlainText(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

function promptEditorValueFromPlainText(text: string): PromptEditorValue {
  return { text: normalizePastedPlainText(text), mentions: [] };
}

function promptEditorValueFromRichHtml(
  html: string,
): ParsedRichClipboardValue {
  const document = new DOMParser().parseFromString(html, "text/html");
  let text = "";
  let hasMentions = false;
  const mentions: PromptTextMention[] = [];

  const appendNewline = () => {
    text = text.replace(/[ \t]+$/u, "");
    if (text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  };

  const appendCollapsedText = (rawText: string) => {
    const collapsedText = rawText.replace(/\s+/gu, " ");
    if (collapsedText.trim().length === 0) {
      if (text.length > 0 && !/[\s]$/u.test(text)) {
        text += " ";
      }
      return;
    }
    text += collapsedText;
  };

  const appendClipboardMention = (element: Element): boolean => {
    const payload = parsePromptMentionClipboardElement({ element });
    if (!payload) {
      return false;
    }

    const start = text.length;
    text += payload.serializedText;
    mentions.push({
      start,
      end: text.length,
      resource: payload.resource,
    });
    hasMentions = true;
    return true;
  };

  const visitChildren = (node: Node, preserveWhitespace: boolean) => {
    for (const childNode of node.childNodes) {
      visitNode(childNode, preserveWhitespace);
    }
  };

  const visitNode = (node: Node, preserveWhitespace: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const rawText = node.textContent ?? "";
      if (preserveWhitespace) {
        text += normalizePastedPlainText(rawText);
        return;
      }
      appendCollapsedText(rawText);
      return;
    }

    if (!(node instanceof Element)) {
      visitChildren(node, preserveWhitespace);
      return;
    }

    const tagName = node.tagName.toUpperCase();
    if (RICH_PASTE_IGNORED_TAGS.has(tagName)) {
      return;
    }
    if (appendClipboardMention(node)) {
      return;
    }
    if (tagName === "BR") {
      appendNewline();
      return;
    }
    if (tagName === "PRE") {
      appendNewline();
      text += normalizePastedPlainText(node.textContent ?? "");
      appendNewline();
      return;
    }
    if (tagName === "LI") {
      appendNewline();
      text += "- ";
      visitChildren(node, preserveWhitespace);
      appendNewline();
      return;
    }
    if (RICH_PASTE_BLOCK_TAGS.has(tagName)) {
      appendNewline();
      visitChildren(node, preserveWhitespace);
      appendNewline();
      return;
    }

    visitChildren(node, preserveWhitespace);
  };

  visitChildren(document.body, false);

  if (hasMentions) {
    const trimmedText = text.replace(/\n+$/u, "");
    return {
      hasMentions,
      value: {
        text: trimmedText,
        mentions: mentions.filter(
          (mention) =>
            mention.start >= 0 &&
            mention.end > mention.start &&
            mention.end <= trimmedText.length,
        ),
      },
    };
  }

  return {
    hasMentions,
    value: {
      text: text
        .replace(/[ \t]+\n/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .replace(/^\n+/u, "")
        .replace(/\n+$/u, ""),
      mentions: [],
    },
  };
}

function promptEditorValueFromClipboardPaste(
  clipboardData: DataTransfer | null,
): PromptEditorValue | null {
  const html = clipboardData?.getData("text/html") ?? "";
  const hasHtml = html.trim().length > 0;
  if (hasHtml) {
    const richValue = promptEditorValueFromRichHtml(html);
    if (richValue.hasMentions) {
      return richValue.value;
    }
  }

  const plainText = clipboardData?.getData("text/plain") ?? "";
  if (plainText.length > 0) {
    return promptEditorValueFromPlainText(plainText);
  }

  if (!hasHtml) {
    return null;
  }

  return promptEditorValueFromRichHtml(html).value;
}

function findActiveEditorMention(editor: Editor): ActiveEditorMention | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const textBeforeCursor = editor.state.doc.textBetween(
    0,
    selection.from,
    "\n",
    "\n",
  );
  const match = EDITOR_MENTION_PATTERN.exec(textBeforeCursor);
  if (!match) return null;

  const query = match[2] ?? "";
  const from = selection.from - query.length - 1;
  if (from < 0) return null;

  return {
    query,
    from,
    to: selection.from,
  };
}

function revealPromptEditorSelection({
  editor,
  scrollContainer,
}: PromptEditorSelectionRevealArgs): void {
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  if (scrollContainerRect.height <= 0) return;

  let selectionRect: ReturnType<Editor["view"]["coordsAtPos"]>;
  try {
    selectionRect = editor.view.coordsAtPos(editor.state.selection.to);
  } catch {
    return;
  }

  const topOverflow =
    selectionRect.top -
    scrollContainerRect.top -
    PROMPTBOX_SELECTION_REVEAL_MARGIN;
  if (topOverflow < 0) {
    scrollContainer.scrollTop = Math.max(
      0,
      scrollContainer.scrollTop + topOverflow,
    );
    return;
  }

  const bottomOverflow =
    selectionRect.bottom -
    scrollContainerRect.bottom +
    PROMPTBOX_SELECTION_REVEAL_MARGIN;
  if (bottomOverflow > 0) {
    scrollContainer.scrollTop += bottomOverflow;
  }
}

function isPromptBoxChromeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  return target.closest(PROMPTBOX_INTERACTIVE_TARGET_SELECTOR) === null;
}

export function PromptBoxInternal({
  id,
  value,
  mentionRanges,
  onChange,
  onSubmit,
  placeholder = "Ask anything. @ to mention files or folders",
  className,
  header,
  footerStart,
  autoFocus = false,
  submission = {},
  minHeight = PROMPTBOX_MIN_HEIGHT,
  mentions,
  mentionMenuPlacement,
  attachments: attachmentConfig = {},
  zenMode = {},
  history,
  voice,
  promptBoxRef,
}: PromptBoxInternalProps) {
  const {
    isSubmitting = false,
    disabled: submitDisabled = false,
    title: submitTitle = "Submit (Enter)",
    isRunning = false,
    onStop,
    onModifierSubmit,
    allowEmptyInput = false,
  } = submission;
  const {
    suggestions: mentionSuggestions,
    isLoading: mentionLoading,
    isError: mentionError,
    onQueryChange: onMentionQueryChange,
    resolveLink: mentionResolveLink,
  } = mentions;
  const {
    items: attachments = [],
    isAttaching = false,
    error: attachmentError = null,
    onAttachFiles,
    onRemove: onRemoveAttachment,
    projectId: attachmentProjectId,
  } = attachmentConfig;
  const {
    layout: zenModeLayout = "thread",
    storageKey: zenModeStorageKey,
    resetKey: zenModeResetKey,
    resetOnSubmit: resetZenModeOnSubmit = false,
  } = zenMode;
  const isPointerCoarse = usePointerCoarse();
  const canSubmitWithEnterKey = !isPointerCoarse;
  const editorEnterKeyHint = isPointerCoarse ? "enter" : "send";
  const formRef = useRef<HTMLFormElement>(null);
  const heightAnimationFromRef = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);
  const revealSelectionFrameRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const mentionRangesRef = useRef<readonly PromptTextMention[]>(mentionRanges);
  const placeholderRef = useRef(placeholder);
  const skipEditorChangeRef = useRef(false);
  const editorValueKeyRef = useRef("");
  const mentionKeyRef = useRef("");
  const handleEditorKeyDownRef = useRef<(event: KeyboardEvent) => boolean>(
    () => false,
  );
  const onAttachFilesRef = useRef(onAttachFiles);
  const dismissedMentionRef = useRef<DismissedMentionRange | null>(null);
  const isRestoringAppliedMentionRef = useRef(false);
  const [activeMention, setActiveMention] =
    useState<ActiveEditorMention | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number | null>(
    null,
  );
  const [temporaryHistoryDraft, setTemporaryHistoryDraft] =
    useState<PromptDraftState | null>(null);
  const [recalledHistoryDraft, setRecalledHistoryDraft] =
    useState<PromptDraftState | null>(null);
  const resolvedZenModeStorageKey =
    zenModeStorageKey ?? ZEN_MODE_STORAGE_KEY[zenModeLayout];
  const zenModeAtom = useMemo(
    () =>
      resolvedZenModeStorageKey
        ? atomWithStorage<boolean>(
            resolvedZenModeStorageKey,
            false,
            createJsonLocalStorage<boolean>(),
            {
              getOnInit: true,
            },
          )
        : createTransientZenModeAtom(),
    [resolvedZenModeStorageKey],
  );
  const [isZenMode, setIsZenMode] = useAtom(zenModeAtom);
  const autoFocusScopeKey = history?.resetKey;
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onAttachFilesRef.current = onAttachFiles;
  }, [onAttachFiles]);

  const revealEditorSelection = useCallback(() => {
    const currentEditor = editorRef.current;
    const scrollContainer = editorScrollContainerRef.current;
    if (!currentEditor || currentEditor.isDestroyed || !scrollContainer) return;

    revealPromptEditorSelection({
      editor: currentEditor,
      scrollContainer,
    });
  }, []);

  const scheduleRevealEditorSelection = useCallback(() => {
    if (typeof requestAnimationFrame !== "function") {
      revealEditorSelection();
      return;
    }

    if (revealSelectionFrameRef.current !== null) {
      cancelAnimationFrame(revealSelectionFrameRef.current);
    }

    revealSelectionFrameRef.current = requestAnimationFrame(() => {
      revealSelectionFrameRef.current = null;
      revealEditorSelection();
    });
  }, [revealEditorSelection]);

  useEffect(() => {
    return () => {
      if (revealSelectionFrameRef.current === null) return;
      cancelAnimationFrame(revealSelectionFrameRef.current);
    };
  }, []);

  const syncMentionState = useCallback(
    (editor: Editor) => {
      const caretPosition = editor.state.selection.from;
      const dismissedMention = dismissedMentionRef.current;
      const isRestoringAppliedMention =
        isRestoringAppliedMentionRef.current && dismissedMention !== null;

      if (dismissedMention && !isRestoringAppliedMention) {
        const isWithinDismissedRange =
          caretPosition >= dismissedMention.start &&
          caretPosition <= dismissedMention.end;

        if (!isWithinDismissedRange) {
          dismissedMentionRef.current = {
            ...dismissedMention,
            hasLeftRange: true,
          };
        } else if (dismissedMention.hasLeftRange) {
          dismissedMentionRef.current = null;
        }
      }

      const shouldSuppressMention = Boolean(
        dismissedMentionRef.current &&
        !dismissedMentionRef.current.hasLeftRange &&
        (isRestoringAppliedMention ||
          (caretPosition >= dismissedMentionRef.current.start &&
            caretPosition <= dismissedMentionRef.current.end)),
      );

      const nextMention = shouldSuppressMention
        ? null
        : findActiveEditorMention(editor);
      const nextKey = nextMention
        ? `${nextMention.from}:${nextMention.to}:${nextMention.query}`
        : "";
      if (nextKey !== mentionKeyRef.current) {
        mentionKeyRef.current = nextKey;
        setSelectedMentionIndex(0);
      }
      setActiveMention(nextMention);

      onMentionQueryChange(nextMention ? nextMention.query : null);
    },
    [onMentionQueryChange],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        listItem: false,
        orderedList: false,
        strike: false,
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
      PromptMentionExtension,
    ],
    content: promptEditorContentFromValue({
      text: value,
      mentions: mentionRanges,
    }),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": placeholder,
        "data-placeholder": placeholder,
        ...(onModifierSubmit ? { "aria-keyshortcuts": "Meta+Enter" } : {}),
        autocomplete: "off",
        class: cn(
          "min-h-full whitespace-pre-wrap break-words outline-none",
          "placeholder:select-none placeholder:text-subtle-foreground",
        ),
        enterkeyhint: editorEnterKeyHint,
        ...(id ? { id } : {}),
        role: "textbox",
      },
      handleDOMEvents: {
        blur: () => {
          mentionKeyRef.current = "";
          if (dismissedMentionRef.current) {
            dismissedMentionRef.current = {
              ...dismissedMentionRef.current,
              hasLeftRange: true,
            };
          }
          setActiveMention(null);
          onMentionQueryChange(null);
          return false;
        },
      },
      handleClick: () => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;
        syncMentionState(currentEditor);
        return false;
      },
      handleKeyDown: (_view, event) => {
        return handleEditorKeyDownRef.current(event);
      },
      handlePaste: (_view, event) => {
        const attachFiles = onAttachFilesRef.current;
        const clipboardItems = Array.from(event.clipboardData?.items ?? []);
        const pastedFiles = clipboardItems
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);

        if (attachFiles && pastedFiles.length > 0) {
          event.preventDefault();
          void attachFiles(pastedFiles);
          return true;
        }

        const pastedValue = promptEditorValueFromClipboardPaste(
          event.clipboardData ?? null,
        );
        if (pastedValue === null) return false;

        event.preventDefault();
        if (pastedValue.text.length === 0) return true;

        editorRef.current
          ?.chain()
          .focus()
          .insertContent(promptEditorInlineContentFromValue(pastedValue))
          .run();
        return true;
      },
    },
    onCreate({ editor: createdEditor }) {
      editorRef.current = createdEditor;
      editorValueKeyRef.current = promptEditorValueKey({
        text: value,
        mentions: mentionRanges,
      });
    },
    onSelectionUpdate({ editor: updatedEditor }) {
      syncMentionState(updatedEditor);
      scheduleRevealEditorSelection();
    },
    onUpdate({ editor: updatedEditor }) {
      if (skipEditorChangeRef.current) return;
      const nextValue = promptEditorValueFromDoc(updatedEditor.state.doc);
      editorValueKeyRef.current = promptEditorValueKey(nextValue);
      onChangeRef.current(nextValue.text, nextValue.mentions);
      syncMentionState(updatedEditor);
      scheduleRevealEditorSelection();
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useLayoutEffect(() => {
    placeholderRef.current = placeholder;
    if (!editor) return;

    editor.view.dom.setAttribute("aria-label", placeholder);
    editor.view.dom.setAttribute("data-placeholder", placeholder);
    editor.view.dom.setAttribute("enterkeyhint", editorEnterKeyHint);
    editor.view.dispatch(editor.state.tr);
  }, [editor, editorEnterKeyHint, placeholder]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    if (!editor) return;

    editor.commands.focus("end");
    scheduleRevealEditorSelection();
  }, [autoFocus, autoFocusScopeKey, editor, scheduleRevealEditorSelection]);

  useEffect(() => {
    mentionRangesRef.current = mentionRanges;
  }, [mentionRanges]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!editor) return;
    const nextValue = {
      text: value,
      mentions: mentionRanges,
    };
    const nextKey = promptEditorValueKey(nextValue);
    if (nextKey === editorValueKeyRef.current) {
      return;
    }

    try {
      skipEditorChangeRef.current = true;
      editor.commands.setContent(promptEditorContentFromValue(nextValue));
      editorValueKeyRef.current = nextKey;
    } finally {
      skipEditorChangeRef.current = false;
    }
    syncMentionState(editor);
    scheduleRevealEditorSelection();
  }, [
    editor,
    mentionRanges,
    scheduleRevealEditorSelection,
    syncMentionState,
    value,
  ]);

  useEffect(() => {
    if (zenModeResetKey === undefined) return;
    if (resolvedZenModeStorageKey) {
      setIsZenMode(RESET);
      return;
    }
    setIsZenMode(false);
  }, [resolvedZenModeStorageKey, setIsZenMode, zenModeResetKey]);

  useLayoutEffect(() => {
    scheduleRevealEditorSelection();
  }, [isZenMode, minHeight, scheduleRevealEditorSelection]);

  const resetHistorySession = useCallback(() => {
    setActiveHistoryIndex(null);
    setTemporaryHistoryDraft(null);
    setRecalledHistoryDraft(null);
  }, []);

  useEffect(() => {
    if (!history) {
      resetHistorySession();
      return;
    }
    if (history.entries.length === 0) {
      resetHistorySession();
      return;
    }
    if (
      activeHistoryIndex !== null &&
      activeHistoryIndex >= history.entries.length
    ) {
      resetHistorySession();
    }
  }, [activeHistoryIndex, history, resetHistorySession]);

  useEffect(() => {
    resetHistorySession();
  }, [history?.resetKey, resetHistorySession]);

  useEffect(() => {
    if (!history || activeHistoryIndex === null || !recalledHistoryDraft) {
      return;
    }
    const activeHistoryEntry = history.entries[activeHistoryIndex];
    if (
      !activeHistoryEntry ||
      !arePromptDraftStatesEqual(activeHistoryEntry, recalledHistoryDraft)
    ) {
      resetHistorySession();
      return;
    }
    if (arePromptDraftStatesEqual(history.currentDraft, recalledHistoryDraft)) {
      return;
    }
    resetHistorySession();
  }, [activeHistoryIndex, history, recalledHistoryDraft, resetHistorySession]);

  useLayoutEffect(() => {
    const fromHeight = heightAnimationFromRef.current;
    const formElement = formRef.current;
    if (fromHeight === null || !formElement) return;
    heightAnimationFromRef.current = null;

    const previousTransition = formElement.style.transition;
    const previousWillChange = formElement.style.willChange;

    formElement.style.transition = "none";
    formElement.style.height = "";
    const toHeight = formElement.getBoundingClientRect().height;
    formElement.style.height = `${fromHeight}px`;
    formElement.getBoundingClientRect();
    formElement.style.willChange = "height";
    formElement.style.transition =
      "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";
    formElement.style.height = `${toHeight}px`;

    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      formElement.style.transition = previousTransition;
      formElement.style.willChange = previousWillChange;
      formElement.style.height = "";
      formElement.removeEventListener("transitionend", handleTransitionEnd);
      window.clearTimeout(fallbackTimeout);
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "height") return;
      cleanup();
    };
    const fallbackTimeout = window.setTimeout(cleanup, 320);
    formElement.addEventListener("transitionend", handleTransitionEnd);

    return cleanup;
  }, [zenModeLayout]);

  const trimmedValue = value.trim();
  const hasAttachments = attachments.length > 0;
  const hasSubmittableInput = trimmedValue.length > 0 || hasAttachments;
  const showMentionMenu = activeMention !== null;
  const activeMentionQuery = activeMention?.query.trim() ?? "";
  const mentionMenuState: MentionMenuState =
    activeMentionQuery.length === 0
      ? { kind: "hint" }
      : mentionLoading
        ? { kind: "loading" }
        : mentionError
          ? { kind: "error" }
          : {
              kind: "results",
              suggestions: mentionSuggestions,
            };

  useEffect(() => {
    if (mentionSuggestions.length === 0) {
      setSelectedMentionIndex(0);
      return;
    }
    if (selectedMentionIndex >= mentionSuggestions.length) {
      setSelectedMentionIndex(0);
    }
  }, [mentionSuggestions.length, selectedMentionIndex]);

  const applyMention = useCallback(
    (item: PromptMentionSuggestion) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || !activeMention) return;

      const serializedText = `@${item.replacement.trim()}`;
      const resource = promptMentionResourceFromSuggestion(item);
      const followingText = currentEditor.state.doc.textBetween(
        activeMention.to,
        Math.min(activeMention.to + 1, currentEditor.state.doc.content.size),
        "\n",
        "\n",
      );
      const trailingText = /^\s/u.test(followingText) ? "" : " ";
      mentionKeyRef.current = "";
      dismissedMentionRef.current = {
        start: activeMention.from,
        end: activeMention.from + 2,
        hasLeftRange: false,
      };
      isRestoringAppliedMentionRef.current = true;
      setActiveMention(null);
      setSelectedMentionIndex(0);
      onMentionQueryChange(null);

      try {
        skipEditorChangeRef.current = true;
        currentEditor
          .chain()
          .focus()
          .deleteRange({ from: activeMention.from, to: activeMention.to })
          .insertContent([
            {
              type: "mention",
              attrs: {
                resource,
                serializedText,
              },
            },
            ...(trailingText ? [{ type: "text", text: trailingText }] : []),
          ])
          .run();
      } finally {
        skipEditorChangeRef.current = false;
      }
      const nextValue = promptEditorValueFromDoc(currentEditor.state.doc);
      editorValueKeyRef.current = promptEditorValueKey(nextValue);
      onChangeRef.current(nextValue.text, nextValue.mentions);

      requestAnimationFrame(() => {
        const nextEditor = editorRef.current;
        if (!nextEditor || nextEditor.isDestroyed) {
          isRestoringAppliedMentionRef.current = false;
          return;
        }
        nextEditor.commands.focus();
        syncMentionState(nextEditor);
        scheduleRevealEditorSelection();
        isRestoringAppliedMentionRef.current = false;
      });
    },
    [
      activeMention,
      onMentionQueryChange,
      scheduleRevealEditorSelection,
      syncMentionState,
    ],
  );

  const focusEnd = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) return;
    currentEditor.commands.focus("end");
    scheduleRevealEditorSelection();
  }, [scheduleRevealEditorSelection]);

  const insertTextAtCursor = useCallback(
    (rawText: string) => {
      const normalizedText = rawText.replace(/\s+/g, " ").trim();
      if (normalizedText.length === 0) return;

      const currentEditor = editorRef.current;
      const currentValue = valueRef.current;
      if (!currentEditor) {
        const nextValue =
          currentValue.length === 0 || /\s$/.test(currentValue)
            ? `${currentValue}${normalizedText}`
            : `${currentValue} ${normalizedText}`;
        onChangeRef.current(nextValue, [...mentionRangesRef.current]);
        return;
      }

      const selection = currentEditor.state.selection;
      const before = currentEditor.state.doc.textBetween(
        0,
        selection.from,
        "\n",
        "\n",
      );
      const after = currentEditor.state.doc.textBetween(
        selection.to,
        currentEditor.state.doc.content.size,
        "\n",
        "\n",
      );
      const needsLeadingWhitespace = before.length > 0 && !/\s$/.test(before);
      const needsTrailingWhitespace = after.length > 0 && !/^\s/.test(after);
      const insertedText = `${needsLeadingWhitespace ? " " : ""}${normalizedText}${needsTrailingWhitespace ? " " : ""}`;

      currentEditor.chain().focus().insertContent(insertedText).run();
      scheduleRevealEditorSelection();
    },
    [scheduleRevealEditorSelection],
  );

  const getTextBeforeCursor = useCallback((): string | undefined => {
    const currentValue = valueRef.current;
    const currentEditor = editorRef.current;
    if (!currentEditor) {
      const trimmed = currentValue.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    const beforeCursor = currentEditor.state.doc
      .textBetween(0, currentEditor.state.selection.from, "\n", "\n")
      .trim();
    return beforeCursor.length > 0 ? beforeCursor : undefined;
  }, []);

  useImperativeHandle(
    promptBoxRef,
    () => ({
      focusEnd,
      insertTextAtCursor,
      getTextBeforeCursor,
    }),
    [focusEnd, insertTextAtCursor, getTextBeforeCursor],
  );

  const isVoiceRecording = voice?.state === "recording";
  const isVoiceProcessing = voice?.state === "transcribing";
  const isVoiceBusy = isVoiceRecording || isVoiceProcessing;
  const showVoiceActionGroup = isVoiceRecording || isVoiceProcessing;
  const canSubmit =
    (hasSubmittableInput || allowEmptyInput) &&
    !isSubmitting &&
    !submitDisabled &&
    !isVoiceBusy;
  const canModifierSubmit =
    onModifierSubmit !== undefined &&
    !isSubmitting &&
    !submitDisabled &&
    !isVoiceBusy;
  const showStop = Boolean(isRunning && onStop && !canSubmit && !isVoiceBusy);
  const canStartVoiceInput =
    voice !== undefined && voice.isSupported && !isSubmitting;
  const effectiveSubmitTitle = isZenMode
    ? submitTitle.replace(/^Submit\s+/, "")
    : submitTitle;

  const emitAttachmentFiles = useCallback(
    (files: File[]) => {
      if (!onAttachFiles || files.length === 0) return;
      void onAttachFiles(files);
    },
    [onAttachFiles],
  );

  const resetZenModeAfterSubmit = useCallback(() => {
    if (!resetZenModeOnSubmit || !isZenMode) return;
    if (resolvedZenModeStorageKey) {
      setIsZenMode(RESET);
      return;
    }
    setIsZenMode(false);
  }, [
    isZenMode,
    resetZenModeOnSubmit,
    resolvedZenModeStorageKey,
    setIsZenMode,
  ]);

  const submitPrompt = useCallback(() => {
    if (!canSubmit) return;
    onSubmit();
    resetZenModeAfterSubmit();
  }, [canSubmit, onSubmit, resetZenModeAfterSubmit]);

  const submitModifierPrompt = useCallback(() => {
    if (!canModifierSubmit || !onModifierSubmit) return;
    onModifierSubmit();
    resetZenModeAfterSubmit();
  }, [canModifierSubmit, onModifierSubmit, resetZenModeAfterSubmit]);

  const applyHistoryDraft = useCallback(
    (draft: PromptDraftState) => {
      if (!history) {
        return;
      }

      history.onSelectEntry(draft);
      requestAnimationFrame(() => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) {
          return;
        }

        currentEditor.commands.focus("end");
        syncMentionState(currentEditor);
        scheduleRevealEditorSelection();
      });
    },
    [history, scheduleRevealEditorSelection, syncMentionState],
  );

  const toggleZenMode = useCallback(() => {
    const formElement = formRef.current;
    heightAnimationFromRef.current =
      formElement?.getBoundingClientRect().height ?? null;

    setIsZenMode((previous) => !previous);

    requestAnimationFrame(() => {
      editorRef.current?.commands.focus();
      scheduleRevealEditorSelection();
    });
  }, [scheduleRevealEditorSelection, setIsZenMode]);

  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;
      emitAttachmentFiles(Array.from(fileList));
      event.target.value = "";
    },
    [emitAttachmentFiles],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt();
  };

  const handlePromptBoxMouseDown = useCallback(
    (event: PromptBoxMouseDownEvent) => {
      if (!isPromptBoxChromeTarget(event.target)) return;

      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return;

      event.preventDefault();
      currentEditor.commands.focus("end");
      scheduleRevealEditorSelection();
    },
    [scheduleRevealEditorSelection],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const currentEditor = editorRef.current;
      const selection = currentEditor?.state.selection;
      const hasCollapsedSelection = Boolean(selection?.empty);
      const hasArrowNavigationModifier =
        event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;
      const hasCursorAtEnd =
        hasCollapsedSelection &&
        currentEditor !== null &&
        currentEditor !== undefined &&
        selection !== undefined &&
        selection.from >= currentEditor.state.doc.content.size - 1;
      const activeHistoryEntry =
        history && activeHistoryIndex !== null
          ? history.entries[activeHistoryIndex]
          : null;
      const hasSelectedHistoryEntry = Boolean(
        history &&
        activeHistoryEntry !== null &&
        activeHistoryEntry !== undefined &&
        arePromptDraftStatesEqual(history.currentDraft, activeHistoryEntry),
      );
      const canNavigateHistory =
        history !== undefined &&
        !hasArrowNavigationModifier &&
        hasCursorAtEnd &&
        (isPromptDraftEmpty(history.currentDraft) || hasSelectedHistoryEntry);
      const canNavigateMentions =
        showMentionMenu && !hasArrowNavigationModifier && !canNavigateHistory;

      if (showMentionMenu) {
        if (
          event.key === "ArrowDown" &&
          canNavigateMentions &&
          mentionSuggestions.length > 0
        ) {
          event.preventDefault();
          setSelectedMentionIndex(
            (prev) => (prev + 1) % mentionSuggestions.length,
          );
          return true;
        }
        if (
          event.key === "ArrowUp" &&
          canNavigateMentions &&
          mentionSuggestions.length > 0
        ) {
          event.preventDefault();
          setSelectedMentionIndex(
            (prev) =>
              (prev + mentionSuggestions.length - 1) %
              mentionSuggestions.length,
          );
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          mentionSuggestions.length > 0
        ) {
          event.preventDefault();
          const selected =
            mentionSuggestions[selectedMentionIndex] ?? mentionSuggestions[0];
          if (selected) {
            applyMention(selected);
          }
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          mentionKeyRef.current = "";
          if (activeMention) {
            dismissedMentionRef.current = {
              start: activeMention.from,
              end: activeMention.to,
              hasLeftRange: false,
            };
          }
          setActiveMention(null);
          onMentionQueryChange(null);
          return true;
        }
      }

      if (history) {
        if (
          event.key === "ArrowUp" &&
          canNavigateHistory &&
          history.entries.length > 0
        ) {
          event.preventDefault();
          const nextHistoryIndex =
            activeHistoryIndex === null
              ? 0
              : Math.min(activeHistoryIndex + 1, history.entries.length - 1);
          if (activeHistoryIndex === null) {
            setTemporaryHistoryDraft(history.currentDraft);
          }
          setActiveHistoryIndex(nextHistoryIndex);
          const nextDraft = history.entries[nextHistoryIndex];
          setRecalledHistoryDraft(nextDraft);
          applyHistoryDraft(nextDraft);
          return true;
        }

        if (
          event.key === "ArrowDown" &&
          canNavigateHistory &&
          activeHistoryIndex !== null
        ) {
          event.preventDefault();
          if (activeHistoryIndex === 0) {
            if (temporaryHistoryDraft) {
              applyHistoryDraft(temporaryHistoryDraft);
            }
            resetHistorySession();
            return true;
          }

          const nextHistoryIndex = activeHistoryIndex - 1;
          setActiveHistoryIndex(nextHistoryIndex);
          const nextDraft = history.entries[nextHistoryIndex];
          setRecalledHistoryDraft(nextDraft);
          applyHistoryDraft(nextDraft);
          return true;
        }
      }

      const isModifierSubmitKey =
        event.key === "Enter" &&
        event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey;
      if (isModifierSubmitKey && onModifierSubmit) {
        event.preventDefault();
        submitModifierPrompt();
        return true;
      }

      if (isZenMode || !canSubmitWithEnterKey) return false;
      const isSubmitKey = event.key === "Enter" && !event.shiftKey;

      if (!isSubmitKey) return false;
      event.preventDefault();
      submitPrompt();
      return true;
    },
    [
      activeHistoryIndex,
      activeMention,
      applyHistoryDraft,
      applyMention,
      canSubmitWithEnterKey,
      history,
      isZenMode,
      mentionSuggestions,
      onMentionQueryChange,
      onModifierSubmit,
      resetHistorySession,
      selectedMentionIndex,
      showMentionMenu,
      submitModifierPrompt,
      submitPrompt,
      temporaryHistoryDraft,
    ],
  );

  useEffect(() => {
    handleEditorKeyDownRef.current = handleEditorKeyDown;
  }, [handleEditorKeyDown]);

  return (
    <form
      ref={formRef}
      data-promptbox=""
      onSubmit={handleSubmit}
      onMouseDown={handlePromptBoxMouseDown}
      onDragOver={(event) => {
        if (!onAttachFiles) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (!onAttachFiles) return;
        event.preventDefault();
        if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0)
          return;
        emitAttachmentFiles(Array.from(event.dataTransfer.files));
      }}
      className={cn(
        "relative w-full rounded-lg border border-border bg-background pb-2",
        // Zen toggles only the *height* of the box; the inset padding stays
        // identical so the placeholder/text doesn't jump when toggling.
        // `flex flex-col` lets the editor's `flex-1` fill the dvh height.
        isZenMode && "flex flex-col",
        isZenMode && ZEN_MODE_HEIGHT_CLASS[zenModeLayout],
        className,
      )}
    >
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      {header ? (
        // Left padding matches the editor's so the header content aligns
        // with the placeholder column in both normal and zen modes (editor
        // shifts from px-4 to px-6 when entering zen). Right padding leaves
        // room for the zen-mode toggle button in the top-right corner. Zen
        // mode also gets more top room since the card fills the viewport.
        <div className="pl-4 pr-14 pt-3">{header}</div>
      ) : null}
      <div className={cn("relative", isZenMode && "flex flex-1 flex-col")}>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={toggleZenMode}
          title={isZenMode ? "Exit zen mode" : "Enter zen mode"}
          aria-label={isZenMode ? "Exit zen mode" : "Enter zen mode"}
          aria-pressed={isZenMode}
          // Neutralise the ghost variant's `aria-pressed:bg-state-active`
          // styling — the icon swap (Maximize2 ↔ Minimize2) is the only
          // state cue we want for zen mode.
          className="absolute right-2 top-2 z-20 size-auto h-6 px-1.5 text-subtle-foreground hover:text-muted-foreground aria-pressed:bg-transparent aria-pressed:text-subtle-foreground aria-pressed:hover:bg-transparent aria-pressed:hover:text-muted-foreground"
        >
          {isZenMode ? (
            <Icon name="Minimize2" className="size-3" />
          ) : (
            <Icon name="Maximize2" className="size-3" />
          )}
        </Button>
        <div
          ref={editorScrollContainerRef}
          data-promptbox-editor-scroll=""
          className={cn(
            "w-full overflow-y-auto bg-transparent px-4 pb-1 pr-14 pt-3 outline-none",
            COARSE_POINTER_TEXT_BASE_CLASS,
            // Keep line-height after the text-size class. tailwind-merge treats
            // text size utilities as owning line-height and would otherwise
            // drop this, making composer rows tighter than timeline messages.
            "leading-relaxed",
            // Zen mode only adds the flex-fill behavior so the editor
            // stretches to the dvh-sized form. Inset padding (px / pt / pb)
            // is identical between modes — toggling shouldn't shift the
            // placeholder position.
            isZenMode && "min-h-0 flex-1",
          )}
          style={{
            minHeight: isZenMode ? "0px" : `${minHeight}px`,
            height: isZenMode ? "100%" : undefined,
            maxHeight: isZenMode
              ? "none"
              : PROMPTBOX_MAX_HEIGHT_BY_LAYOUT[zenModeLayout],
          }}
        >
          <PromptMentionLinkContext.Provider value={mentionResolveLink ?? null}>
            <EditorContent
              editor={editor}
              className={cn(
                "h-full min-h-full",
                "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:leading-relaxed [&_.ProseMirror]:outline-none",
                "[&_.ProseMirror_p]:m-0",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle-foreground",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
              )}
            />
          </PromptMentionLinkContext.Provider>
        </div>
      </div>

      {showMentionMenu ? (
        <div
          className={cn(
            // Zen mode: menu floats inside the form, anchored just above
            // the action footer so it stays visible. The form's pb-3 +
            // ~36px button row sets the bottom offset.
            // Normal mode: menu floats outside the form (above or below).
            // -left-px / -right-px aligns the menu with the form's outer
            // edge (form has a 1px border; left-0/right-0 would otherwise
            // sit inside it, leaving the banner above peeking out 1px on
            // each side).
            "absolute -left-px -right-px z-20",
            isZenMode
              ? "bottom-14 px-3"
              : mentionMenuPlacement === "top"
                ? "bottom-full mb-2"
                : "top-full mt-2",
          )}
        >
          <MentionMenu
            state={mentionMenuState}
            selectedIndex={selectedMentionIndex}
            onApply={applyMention}
          />
        </div>
      ) : null}

      <AttachmentPreview
        attachments={attachments}
        attachmentProjectId={attachmentProjectId}
        expandedImageIndex={expandedImageIndex}
        onExpandedImageIndexChange={setExpandedImageIndex}
        onRemoveAttachment={onRemoveAttachment}
      />

      {attachmentError ? (
        <div className="mx-3 mb-1 mt-1 text-xs text-destructive">
          {attachmentError}
        </div>
      ) : null}

      <div className="flex flex-row items-center gap-3 px-3.5 pt-1.5">
        <div
          className="flex min-w-0 flex-1 flex-row items-center gap-1"
          aria-live="polite"
        >
          {footerStart}
        </div>
        <div className="flex shrink-0 flex-row items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Attach files"
            disabled={!onAttachFiles || isAttaching}
            onClick={() => attachmentInputRef.current?.click()}
            className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
          >
            {isAttaching ? (
              <Icon name="Spinner" className="size-4 animate-spin" />
            ) : (
              <Icon name="Paperclip" className="size-4" />
            )}
          </Button>
          {voice && !showVoiceActionGroup ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title={
                !voice.isSupported
                  ? "Voice input is not supported in this browser"
                  : "Start voice input"
              }
              disabled={!canStartVoiceInput}
              onClick={voice.start}
              className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
            >
              <Icon name="Mic" className="size-4" />
            </Button>
          ) : null}
          {showStop ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              title="Stop run"
              onClick={onStop}
              className={COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS}
            >
              <Icon
                name="Square"
                className="size-3.5 fill-current [&_*]:stroke-0"
              />
            </Button>
          ) : voice && isVoiceRecording ? (
            <div className="relative inline-flex">
              <Button
                type="button"
                size="sm"
                variant="default"
                title="Stop and transcribe recording"
                onClick={voice.stop}
                className={cn(
                  "rounded-r-none",
                  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                )}
              >
                <Icon name="AudioLines" className="size-4 animate-pulse" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                title="Cancel recording"
                onClick={voice.cancel}
                className={COARSE_POINTER_PROMPT_COMBO_BUTTON_CLASS}
              >
                <Icon name="X" className="size-3.5" />
              </Button>
            </div>
          ) : voice && isVoiceProcessing ? (
            <div className="relative inline-flex">
              <Button
                type="button"
                size="sm"
                variant="default"
                title="Transcribing voice input..."
                disabled
                className={cn(
                  "rounded-r-none",
                  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                )}
              >
                <Icon name="AudioLines" className="size-4" />
                <Icon name="Spinner" className="size-4 animate-spin" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                title="Cancel transcription"
                onClick={voice.cancel}
                className={COARSE_POINTER_PROMPT_COMBO_BUTTON_CLASS}
              >
                <Icon name="X" className="size-3.5" />
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              size="sm"
              variant="default"
              title={effectiveSubmitTitle}
              disabled={!canSubmit}
              className={COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS}
            >
              {isSubmitting ? (
                <Icon name="Spinner" className="size-4 animate-spin" />
              ) : isZenMode ? (
                <Icon name="ArrowUp" className="size-4" />
              ) : (
                <Icon name="CornerDownLeft" className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
