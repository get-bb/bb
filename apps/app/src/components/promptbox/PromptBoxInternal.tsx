import { atom, useAtom } from "jotai";
import { RESET, atomWithStorage } from "jotai/utils";
import type { PromptMentionCommandTrigger, PromptTextMention } from "@bb/domain";
import Placeholder from "@tiptap/extension-placeholder";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
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
  ActiveTrigger,
  CommandMenuState,
  MentionMenuState,
  ProviderCommandSuggestion,
  PromptMentionSuggestion,
  TypeaheadMenuState,
  TypeaheadTrigger,
} from "@/components/promptbox/mentions/types";
import { commandPillDismissedRangeEnd } from "@/components/promptbox/mentions/command-trigger";
import { findActiveTrigger } from "@/components/promptbox/mentions/find-active-trigger";
import { canLoadMoreCommandResults } from "@/components/promptbox/mentions/mention-menu-scroll";
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
  PromptBoxActionsMenu,
  type PromptBoxAction,
} from "./PromptBoxActionsMenu";
import {
  PromptMentionLinkContext,
  type PromptMentionLinkResolver,
} from "./editor/prompt-mention-link";
import { PromptMentionExtension } from "./editor/prompt-mention-extension";
import {
  promptCommandResourceFromSuggestion,
  promptEditorContentFromValue,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
  parsePromptEditorMentionAttrs,
  promptMentionResourceFromSuggestion,
  type PromptEditorValue,
} from "./editor/prompt-editor-serialization";
import {
  exitTrailingBlockquoteBreak,
  insertParagraphBeforeBlockquote,
} from "./editor/prompt-editor-blockquote";
import { exitHeading } from "./editor/prompt-editor-heading";
import { applyPromptListNewline } from "./editor/prompt-editor-list";
import { applyPromptParagraphNewline } from "./editor/prompt-editor-paragraph";
import { MentionMenu, type TypeaheadSuggestion } from "./mentions/MentionMenu";
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

function hasWhitespaceAfterPosition(
  doc: ProseMirrorNode,
  position: number,
): boolean {
  const nextNode = doc.resolve(position).nodeAfter;
  if (!nextNode) {
    return false;
  }
  if (nextNode.isText) {
    return /^\s/u.test(nextNode.text ?? "");
  }
  return nextNode.type.name === "hardBreak";
}

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
}

/**
 * The `@`-mention half of {@link TypeaheadConfig}. Unchanged from the prior
 * `MentionsConfig` surface other than living under `typeahead.mention`.
 */
export interface TypeaheadMentionConfig {
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

/**
 * The command-typeahead half of {@link TypeaheadConfig}. `trigger` is the
 * provider's command char or `null` when the provider has no command
 * surface — in which case the composer never activates a command trigger and
 * the rest of this config is inert.
 *
 * Hosts wire `suggestions` / `isLoading` / `isError` from
 * `useCommandSuggestions`; `onQueryChange` feeds that hook the text typed
 * after the trigger (`null` when no command trigger is active).
 */
export interface TypeaheadCommandConfig {
  trigger: PromptMentionCommandTrigger | null;
  suggestions: readonly ProviderCommandSuggestion[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  /** Called whenever the active command query changes; null when no command trigger is active. */
  onQueryChange: (query: string | null) => void;
}

/**
 * Generalized composer typeahead config covering both trigger kinds. `@`
 * mentions are always available; commands are active only when
 * `command.trigger` is non-null. Hosts supply both halves; the composer picks
 * the active trigger from the caret and renders the matching data source.
 */
export interface TypeaheadConfig {
  mention: TypeaheadMentionConfig;
  command: TypeaheadCommandConfig;
}

/**
 * Inert command half: no trigger, no suggestions, no-op query change. Hosts use
 * it as `typeahead.command` until they wire real command data from
 * `useCommandSuggestions`. With `trigger: null` the composer never activates a
 * command trigger, so the rest of the fields are never read.
 */
export const INERT_TYPEAHEAD_COMMAND_CONFIG: TypeaheadCommandConfig = {
  trigger: null,
  suggestions: [],
  isLoading: false,
  isError: false,
  hasMore: false,
  isLoadingMore: false,
  loadMore: () => {},
  onQueryChange: () => {},
};

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

export type { PromptBoxAction } from "./PromptBoxActionsMenu";

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
  submission?: PromptBoxSubmissionConfig;
  /**
   * Minimum textarea height in pixels. Defaults to PROMPTBOX_MIN_HEIGHT.
   * Callers may pass a smaller value to make room for siblings that grow
   * above the textarea (see FollowUpPromptBox's elastic compensation for
   * the context banner stack) — total prompt-area height stays constant.
   */
  minHeight?: number;
  typeahead: TypeaheadConfig;
  /**
   * Where the typeahead menu floats relative to the prompt box.
   * "top" floats it above (used by FollowUp where the prompt sits at the
   * bottom of the thread), "bottom" floats it below (used by NewThread
   * where the prompt sits at the top of the project view).
   */
  mentionMenuPlacement: MentionMenuPlacement;
  attachments?: AttachmentsConfig;
  promptActions?: readonly PromptBoxAction[];
  zenMode?: PromptBoxZenModeConfig;
  history?: HistoryConfig;
  /** When omitted, the mic button is hidden. Wrappers wire this via usePromptVoice. */
  voice?: PromptVoiceConfig;
  promptBoxRef?: Ref<PromptBoxHandle>;
  /**
   * Changing this re-focuses the editor caret to the end. Used by explicit
   * draft-restore actions (e.g. editing a queued message) so the user can type
   * immediately. Unlike the scope autofocus it fires even on coarse pointers,
   * since it follows a deliberate click.
   */
  focusEndKey?: string | number;
}

interface DismissedTriggerRange {
  start: number;
  end: number;
  hasLeftRange: boolean;
}

interface PromptEditorValueKey {
  text: string;
  mentions: readonly PromptTextMention[];
}

const MENTION_TRIGGER: TypeaheadTrigger = { char: "@", kind: "mention" };

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

interface PromptActionInsertionRange {
  from: number;
  to: number;
}

interface PromptActionCommand {
  serializedText: string;
  trailingText: string;
  trigger: PromptMentionCommandTrigger;
  suggestion: ProviderCommandSuggestion;
}

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

function promptActionCommandMentionsFromText(
  text: string,
  actions: readonly PromptBoxAction[] | undefined,
): PromptTextMention[] {
  const mentions: PromptTextMention[] = [];

  for (const action of actions ?? []) {
    const commandAction = promptActionCommandFromAction(action);
    if (commandAction === null) {
      continue;
    }

    let searchStart = 0;
    while (searchStart < text.length) {
      const start = text.indexOf(commandAction.serializedText, searchStart);
      if (start === -1) {
        break;
      }

      const end = start + commandAction.serializedText.length;
      const before = start === 0 ? "" : text[start - 1]!;
      const after = end >= text.length ? "" : text[end]!;
      const hasTokenBoundaryBefore = before === "" || /\s/u.test(before);
      const hasTokenBoundaryAfter = after === "" || /\s/u.test(after);

      if (hasTokenBoundaryBefore && hasTokenBoundaryAfter) {
        mentions.push({
          start,
          end,
          resource: promptCommandResourceFromSuggestion({
            suggestion: commandAction.suggestion,
            trigger: commandAction.trigger,
          }),
        });
      }

      searchStart = end;
    }
  }

  return mentions.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function mergePromptTextMentions(
  baseMentions: readonly PromptTextMention[],
  additionalMentions: readonly PromptTextMention[],
): PromptTextMention[] {
  const merged = [...baseMentions].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  for (const additionalMention of additionalMentions) {
    const overlapsExisting = merged.some(
      (mention) =>
        additionalMention.start < mention.end &&
        additionalMention.end > mention.start,
    );
    if (!overlapsExisting) {
      merged.push(additionalMention);
    }
  }

  return merged.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function withPromptActionCommandMentions(
  value: PromptEditorValue,
  promptActions: readonly PromptBoxAction[] | undefined,
): PromptEditorValue {
  const promptActionMentions = promptActionCommandMentionsFromText(
    value.text,
    promptActions,
  );
  if (promptActionMentions.length === 0) {
    return value;
  }

  return {
    ...value,
    mentions: mergePromptTextMentions(value.mentions, promptActionMentions),
  };
}

function promptEditorValueFromPlainText(
  text: string,
  promptActions?: readonly PromptBoxAction[],
): PromptEditorValue {
  const normalizedText = normalizePastedPlainText(text);
  return withPromptActionCommandMentions(
    {
      text: normalizedText,
      mentions: [],
    },
    promptActions,
  );
}

function promptEditorValueFromRichHtml(html: string): ParsedRichClipboardValue {
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
  promptActions?: readonly PromptBoxAction[],
): PromptEditorValue | null {
  const html = clipboardData?.getData("text/html") ?? "";
  const hasHtml = html.trim().length > 0;
  if (hasHtml) {
    const richValue = promptEditorValueFromRichHtml(html);
    if (richValue.hasMentions) {
      return withPromptActionCommandMentions(richValue.value, promptActions);
    }
  }

  const plainText = clipboardData?.getData("text/plain") ?? "";
  if (plainText.length > 0) {
    return promptEditorValueFromPlainText(plainText, promptActions);
  }

  if (!hasHtml) {
    return null;
  }

  return promptEditorValueFromRichHtml(html).value;
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

function promptActionTextImmediatelyBeforeCursor(
  editor: Editor,
  actionText: string,
): boolean {
  if (!editor.state.selection.empty) {
    return false;
  }

  const before = editor.state.doc.textBetween(
    0,
    editor.state.selection.from,
    "\n",
    "\n",
  );
  return before.endsWith(actionText);
}

function promptActionCommandSerializedText(action: PromptBoxAction): string {
  if (!action.command) {
    return action.text;
  }
  return `${action.command.trigger}${action.command.name}`;
}

function isPromptActionCommandMention(
  node: ProseMirrorNode,
  actions: readonly PromptBoxAction[],
): boolean {
  if (node.type.name !== "mention") {
    return false;
  }
  const attrs = parsePromptEditorMentionAttrs(node.attrs);
  if (!attrs || attrs.resource.kind !== "command") {
    return false;
  }
  const resource = attrs.resource;
  return actions.some((action) => {
    const command = action.command;
    if (!command) {
      return false;
    }
    return (
      resource.trigger === command.trigger &&
      resource.name === command.name &&
      attrs.serializedText === promptActionCommandSerializedText(action)
    );
  });
}

function findPromptActionTextSuffix(
  text: string,
  actions: readonly PromptBoxAction[],
): PromptBoxAction | null {
  return (
    actions.find(
      (action) =>
        !action.command &&
        action.text.length > 0 &&
        text.endsWith(action.text),
    ) ?? null
  );
}

function getPromptActionRangeImmediatelyBeforeCursor({
  editor,
  actions,
}: {
  editor: Editor;
  actions: readonly PromptBoxAction[];
}): PromptActionInsertionRange | null {
  const selection = editor.state.selection;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  const cursorOffset = $from.parentOffset;
  const parentStart = $from.start();
  let searchOffset = cursorOffset;

  while (searchOffset > 0) {
    const previous = $from.parent.childBefore(searchOffset);
    const node = previous.node;
    if (!node) {
      return null;
    }
    const sizeBeforeSearchOffset = searchOffset - previous.offset;
    if (node.isText) {
      const textBeforeCursor = (node.text ?? "").slice(
        0,
        sizeBeforeSearchOffset,
      );
      const textAction = findPromptActionTextSuffix(textBeforeCursor, actions);
      if (textAction) {
        return {
          from:
            parentStart +
            previous.offset +
            textBeforeCursor.length -
            textAction.text.length,
          to: selection.from,
        };
      }
      if (/\S/u.test(textBeforeCursor)) {
        return null;
      }
      searchOffset = previous.offset;
      continue;
    }
    if (
      sizeBeforeSearchOffset === node.nodeSize &&
      isPromptActionCommandMention(node, actions)
    ) {
      return {
        from: parentStart + previous.offset,
        to: selection.from,
      };
    }
    return null;
  }

  return null;
}

function getPromptActionInsertionRange({
  editor,
  action,
  actions,
  triggers,
}: {
  editor: Editor;
  action: PromptBoxAction;
  actions: readonly PromptBoxAction[];
  triggers: readonly TypeaheadTrigger[];
}): PromptActionInsertionRange | null {
  const selection = editor.state.selection;
  if (!selection.empty) {
    return { from: selection.from, to: selection.to };
  }

  const previousPromptActionRange = getPromptActionRangeImmediatelyBeforeCursor({
    editor,
    actions,
  });
  if (previousPromptActionRange !== null) {
    return previousPromptActionRange;
  }

  const activeCommandTrigger = findActiveTrigger(editor, triggers);
  const isActiveCommand =
    activeCommandTrigger !== null && activeCommandTrigger.kind === "command";

  if (action.kind === "skills") {
    if (
      isActiveCommand &&
      activeCommandTrigger.char === action.text &&
      activeCommandTrigger.to === selection.from
    ) {
      return null;
    }
    return { from: selection.from, to: selection.to };
  }

  if (isActiveCommand && activeCommandTrigger.to === selection.from) {
    return {
      from: activeCommandTrigger.from,
      to: activeCommandTrigger.to,
    };
  }

  return { from: selection.from, to: selection.to };
}

function promptActionCommandFromAction(
  action: PromptBoxAction,
): PromptActionCommand | null {
  if (action.kind === "skills" || !action.command) {
    return null;
  }

  const { trigger, name, trailingText } = action.command;
  const serializedText = `${trigger}${name}`;
  return {
    serializedText,
    trailingText,
    trigger,
    suggestion: {
      kind: "command",
      name,
      source: "command",
      origin: "user",
      description: null,
      argumentHint: null,
    },
  };
}

function promptActionTriggers(
  triggers: readonly TypeaheadTrigger[],
  commandAction: PromptActionCommand | null,
): readonly TypeaheadTrigger[] {
  if (commandAction === null) {
    return triggers;
  }
  if (
    triggers.some(
      (trigger) =>
        trigger.kind === "command" && trigger.char === commandAction.trigger,
    )
  ) {
    return triggers;
  }
  return [
    ...triggers,
    { kind: "command", char: commandAction.trigger },
  ] satisfies TypeaheadTrigger[];
}

export function suppressPromptEditorAnchorActivation(event: Event): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest("a[href]") === null) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
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
  submission = {},
  minHeight = PROMPTBOX_MIN_HEIGHT,
  typeahead,
  mentionMenuPlacement,
  attachments: attachmentConfig = {},
  promptActions,
  zenMode = {},
  history,
  voice,
  promptBoxRef,
  focusEndKey,
}: PromptBoxInternalProps) {
  const {
    isSubmitting = false,
    disabled: submitDisabled = false,
    title: submitTitle = "Submit (Enter)",
    isRunning = false,
    onStop,
    onModifierSubmit,
  } = submission;
  const {
    suggestions: mentionSuggestions,
    isLoading: mentionLoading,
    isError: mentionError,
    onQueryChange: onMentionQueryChange,
    resolveLink: mentionResolveLink,
  } = typeahead.mention;
  const {
    trigger: commandTriggerChar,
    suggestions: commandSuggestions,
    isLoading: commandLoading,
    isError: commandError,
    onQueryChange: onCommandQueryChange,
  } = typeahead.command;
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
  // Passive text autofocus opens the soft keyboard on coarse-pointer devices.
  const shouldAvoidSoftKeyboardAutofocus = isPointerCoarse;
  const formRef = useRef<HTMLFormElement>(null);
  const heightAnimationFromRef = useRef<number | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);
  const revealSelectionFrameRef = useRef<number | null>(null);
  const promptActionFocusFrameRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const mentionRangesRef = useRef<readonly PromptTextMention[]>(mentionRanges);
  const placeholderRef = useRef(placeholder);
  const skipEditorChangeRef = useRef(false);
  const editorValueKeyRef = useRef("");
  const triggerKeyRef = useRef("");
  const handleEditorKeyDownRef = useRef<(event: KeyboardEvent) => boolean>(
    () => false,
  );
  // The TipTap editor is created once; its `onUpdate`/`onSelectionUpdate`/click
  // handlers close over the first `syncTriggerState`. `syncTriggerState`
  // depends on the active trigger set, which changes when the thread's provider
  // (command trigger) changes — so route those handlers through a ref kept
  // pointed at the latest closure, mirroring `handleEditorKeyDownRef`.
  const syncTriggerStateRef = useRef<(editor: Editor) => void>(() => {});
  const onAttachFilesRef = useRef(onAttachFiles);
  const dismissedTriggerRef = useRef<DismissedTriggerRange | null>(null);
  const isRestoringAppliedMentionRef = useRef(false);
  const [activeTrigger, setActiveTrigger] = useState<ActiveTrigger | null>(
    null,
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
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
  const focusScopeKey = history?.resetKey;
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

  useEffect(() => {
    return () => {
      if (promptActionFocusFrameRef.current === null) return;
      cancelAnimationFrame(promptActionFocusFrameRef.current);
    };
  }, []);

  // Active trigger set: `@` is always watched; the provider's command trigger
  // joins it when present. A thread is bound to one provider, so this is at
  // most two entries with distinct lead chars — never any trigger ambiguity.
  const triggers = useMemo<TypeaheadTrigger[]>(() => {
    if (commandTriggerChar === null) {
      return [MENTION_TRIGGER];
    }
    return [MENTION_TRIGGER, { char: commandTriggerChar, kind: "command" }];
  }, [commandTriggerChar]);

  // Fan the active query out to the matching data source and null the other,
  // so switching from `@foo` to `/bar` (or vice versa) clears the stale query.
  const dispatchTriggerQuery = useCallback(
    (active: ActiveTrigger | null) => {
      if (active?.kind === "mention") {
        onMentionQueryChange(active.query);
        onCommandQueryChange(null);
        return;
      }
      if (active?.kind === "command") {
        onCommandQueryChange(active.query);
        onMentionQueryChange(null);
        return;
      }
      onMentionQueryChange(null);
      onCommandQueryChange(null);
    },
    [onCommandQueryChange, onMentionQueryChange],
  );

  const syncTriggerState = useCallback(
    (editor: Editor) => {
      const caretPosition = editor.state.selection.from;
      const dismissedTrigger = dismissedTriggerRef.current;
      const isRestoringAppliedMention =
        isRestoringAppliedMentionRef.current && dismissedTrigger !== null;

      if (dismissedTrigger && !isRestoringAppliedMention) {
        const isWithinDismissedRange =
          caretPosition >= dismissedTrigger.start &&
          caretPosition <= dismissedTrigger.end;

        if (!isWithinDismissedRange) {
          dismissedTriggerRef.current = {
            ...dismissedTrigger,
            hasLeftRange: true,
          };
        } else if (dismissedTrigger.hasLeftRange) {
          dismissedTriggerRef.current = null;
        }
      }

      const shouldSuppressTrigger = Boolean(
        dismissedTriggerRef.current &&
        !dismissedTriggerRef.current.hasLeftRange &&
        (isRestoringAppliedMention ||
          (caretPosition >= dismissedTriggerRef.current.start &&
            caretPosition <= dismissedTriggerRef.current.end)),
      );

      const nextTrigger = shouldSuppressTrigger
        ? null
        : findActiveTrigger(editor, triggers);
      const nextKey = nextTrigger
        ? `${nextTrigger.kind}:${nextTrigger.from}:${nextTrigger.to}:${nextTrigger.query}`
        : "";
      if (nextKey !== triggerKeyRef.current) {
        triggerKeyRef.current = nextKey;
        setSelectedIndex(0);
      }
      setActiveTrigger(nextTrigger);

      dispatchTriggerQuery(nextTrigger);
    },
    [dispatchTriggerQuery, triggers],
  );

  useEffect(() => {
    syncTriggerStateRef.current = syncTriggerState;
  }, [syncTriggerState]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Markdown formatting: marks (bold/italic/code) + block nodes
        // (heading/lists/blockquote). Each enabled node/mark has a
        // markdown text representation in prompt-editor-serialization.ts so the
        // submitted prompt is plain markdown. StarterKit ships input rules for
        // these (`# `, `- `, `1. `, `**`, `_`, `` ` ``), so typing applies
        // formatting live. Code blocks/link/underline stay disabled: code
        // blocks make multiline prompt editing too sticky; underline isn't
        // markdown; links need authoring UI we don't provide.
        blockquote: {},
        bold: {},
        bulletList: {},
        code: {},
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: {},
        horizontalRule: false,
        italic: {},
        link: false,
        listItem: {},
        orderedList: {},
        strike: false,
        underline: false,
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
        auxclick: (_view, event) => {
          return suppressPromptEditorAnchorActivation(event);
        },
        blur: () => {
          triggerKeyRef.current = "";
          if (dismissedTriggerRef.current) {
            dismissedTriggerRef.current = {
              ...dismissedTriggerRef.current,
              hasLeftRange: true,
            };
          }
          setActiveTrigger(null);
          onMentionQueryChange(null);
          onCommandQueryChange(null);
          return false;
        },
        click: (_view, event) => {
          return suppressPromptEditorAnchorActivation(event);
        },
      },
      handleClick: () => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;
        syncTriggerStateRef.current(currentEditor);
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
          promptActions,
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
      syncTriggerStateRef.current(updatedEditor);
      scheduleRevealEditorSelection();
    },
    onUpdate({ editor: updatedEditor }) {
      if (skipEditorChangeRef.current) return;
      const nextValue = promptEditorValueFromDoc(updatedEditor.state.doc);
      editorValueKeyRef.current = promptEditorValueKey(nextValue);
      onChangeRef.current(nextValue.text, nextValue.mentions);
      syncTriggerStateRef.current(updatedEditor);
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
    if (shouldAvoidSoftKeyboardAutofocus) return;
    if (!editor) return;

    editor.commands.focus("end");
    scheduleRevealEditorSelection();
  }, [
    editor,
    focusScopeKey,
    scheduleRevealEditorSelection,
    shouldAvoidSoftKeyboardAutofocus,
  ]);

  useEffect(() => {
    mentionRangesRef.current = mentionRanges;
  }, [mentionRanges]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useLayoutEffect(() => {
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
    syncTriggerState(editor);
    scheduleRevealEditorSelection();
  }, [
    editor,
    mentionRanges,
    scheduleRevealEditorSelection,
    syncTriggerState,
    value,
  ]);

  // An explicit draft-restore action (e.g. editing a queued message) bumps
  // `focusEndKey` so the caret lands at the END of the restored text. It is a
  // passive effect defined AFTER the layout content-sync effect above, so the
  // editor has already applied `setContent` for the new draft in the same
  // commit.
  // Not gated by the coarse-pointer guard since it follows a deliberate click.
  const lastFocusEndKeyRef = useRef(focusEndKey);
  useEffect(() => {
    if (focusEndKey === undefined) return;
    if (focusEndKey === lastFocusEndKeyRef.current) return;
    if (!editor) return;
    lastFocusEndKeyRef.current = focusEndKey;
    editor.commands.focus("end");
    scheduleRevealEditorSelection();
  }, [editor, focusEndKey, scheduleRevealEditorSelection]);

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

  const activeTriggerKind = activeTrigger?.kind ?? null;
  const commandHasMore = typeahead.command.hasMore;
  const commandIsLoadingMore = typeahead.command.isLoadingMore;
  const loadMoreCommands = typeahead.command.loadMore;
  const canLoadMoreCommands =
    activeTriggerKind === "command" &&
    canLoadMoreCommandResults({
      hasMore: commandHasMore,
      isError: commandError,
      isLoadingMore: commandIsLoadingMore,
    });
  // The suggestion list driving keyboard nav + Enter/Tab apply for whichever
  // trigger is active. Empty when no trigger is open. Memoized so the keyboard
  // handler's useCallback identity is stable across renders.
  const activeSuggestions = useMemo<readonly TypeaheadSuggestion[]>(
    () =>
      activeTriggerKind === "command"
        ? commandSuggestions
        : activeTriggerKind === "mention"
          ? mentionSuggestions
          : [],
    [activeTriggerKind, commandSuggestions, mentionSuggestions],
  );

  const mentionMenuState: MentionMenuState =
    (activeTrigger?.query.trim() ?? "").length === 0
      ? { kind: "hint" }
      : mentionLoading
        ? { kind: "loading" }
        : mentionError
          ? { kind: "error" }
          : { kind: "results", suggestions: mentionSuggestions };

  const commandMenuState: CommandMenuState = commandLoading
    ? { kind: "loading" }
    : commandError
      ? { kind: "error" }
      : { kind: "results", suggestions: commandSuggestions };

  // Loaded-empty suppression (§6): a command trigger with zero loaded results
  // (not loading, not error) is literal text — never open the menu. Mention
  // triggers always open (they have a hint / "no matches" state).
  const isCommandTriggerLiteral =
    activeTriggerKind === "command" &&
    !commandLoading &&
    !commandError &&
    commandSuggestions.length === 0;
  const showTypeaheadMenu = activeTrigger !== null && !isCommandTriggerLiteral;

  const typeaheadMenuState: TypeaheadMenuState =
    activeTriggerKind === "command"
      ? { trigger: "command", state: commandMenuState }
      : { trigger: "mention", state: mentionMenuState };

  useEffect(() => {
    if (activeSuggestions.length === 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= activeSuggestions.length) {
      setSelectedIndex(0);
    }
  }, [activeSuggestions.length, selectedIndex]);

  useEffect(() => {
    if (
      activeTriggerKind !== "command" ||
      !canLoadMoreCommands ||
      activeSuggestions.length === 0
    ) {
      return;
    }
    const prefetchIndex = Math.max(0, activeSuggestions.length - 3);
    if (selectedIndex >= prefetchIndex) {
      loadMoreCommands();
    }
  }, [
    activeSuggestions.length,
    activeTriggerKind,
    canLoadMoreCommands,
    loadMoreCommands,
    selectedIndex,
  ]);

  // After applying any suggestion the editor content changed outside React's
  // controlled flow; emit the controlled change, then re-focus, re-sync the
  // trigger state, and reveal the caret on the next frame. Shared by the
  // mention and command apply paths.
  const finishApply = useCallback(
    (appliedEditor: Editor) => {
      const nextValue = promptEditorValueFromDoc(appliedEditor.state.doc);
      editorValueKeyRef.current = promptEditorValueKey(nextValue);
      onChangeRef.current(nextValue.text, nextValue.mentions);

      requestAnimationFrame(() => {
        const nextEditor = editorRef.current;
        if (!nextEditor || nextEditor.isDestroyed) {
          isRestoringAppliedMentionRef.current = false;
          return;
        }
        nextEditor.commands.focus();
        syncTriggerState(nextEditor);
        scheduleRevealEditorSelection();
        isRestoringAppliedMentionRef.current = false;
      });
    },
    [scheduleRevealEditorSelection, syncTriggerState],
  );

  const applyMentionSuggestion = useCallback(
    (item: PromptMentionSuggestion) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || activeTrigger === null) return;

      const serializedText = `@${item.replacement.trim()}`;
      const resource = promptMentionResourceFromSuggestion(item);
      const trailingText = hasWhitespaceAfterPosition(
        currentEditor.state.doc,
        activeTrigger.to,
      )
        ? ""
        : " ";
      triggerKeyRef.current = "";
      // Mention dismissed-range basis is node width: trigger char + the 1-wide
      // pill atom in the post-replacement doc (`from` → `from + 2`). Do not
      // change — pill re-trigger suppression depends on it.
      dismissedTriggerRef.current = {
        start: activeTrigger.from,
        end: activeTrigger.from + 2,
        hasLeftRange: false,
      };
      isRestoringAppliedMentionRef.current = true;
      setActiveTrigger(null);
      setSelectedIndex(0);
      onMentionQueryChange(null);

      try {
        skipEditorChangeRef.current = true;
        currentEditor
          .chain()
          .focus()
          .deleteRange({ from: activeTrigger.from, to: activeTrigger.to })
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
      finishApply(currentEditor);
    },
    [activeTrigger, finishApply, onMentionQueryChange],
  );

  const applyCommandSuggestion = useCallback(
    (item: ProviderCommandSuggestion) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || activeTrigger === null) return;
      if (activeTrigger.char !== "/") return;

      const serializedText = `${activeTrigger.char}${item.name}`;
      const resource = promptCommandResourceFromSuggestion({
        suggestion: item,
        trigger: activeTrigger.char,
      });
      const trailingText = hasWhitespaceAfterPosition(
        currentEditor.state.doc,
        activeTrigger.to,
      )
        ? ""
        : " ";
      triggerKeyRef.current = "";
      // Argument hints render as placeholder decorations, not editor text.
      dismissedTriggerRef.current = {
        start: activeTrigger.from,
        end: commandPillDismissedRangeEnd({
          triggerPosition: activeTrigger.from,
          trailingText,
        }),
        hasLeftRange: false,
      };
      isRestoringAppliedMentionRef.current = true;
      setActiveTrigger(null);
      setSelectedIndex(0);
      onCommandQueryChange(null);

      try {
        skipEditorChangeRef.current = true;
        currentEditor
          .chain()
          .focus()
          .deleteRange({ from: activeTrigger.from, to: activeTrigger.to })
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
      finishApply(currentEditor);
    },
    [activeTrigger, finishApply, onCommandQueryChange],
  );

  const applyTrigger = useCallback(
    (item: TypeaheadSuggestion) => {
      if (item.kind === "command") {
        applyCommandSuggestion(item);
        return;
      }
      applyMentionSuggestion(item);
    },
    [applyCommandSuggestion, applyMentionSuggestion],
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

  const focusAfterPromptAction = useCallback(
    (currentEditor: Editor) => {
      const focusEditor = () => {
        promptActionFocusFrameRef.current = null;
        if (currentEditor.isDestroyed) return;
        currentEditor.commands.focus();
        syncTriggerState(currentEditor);
        scheduleRevealEditorSelection();
      };

      if (typeof requestAnimationFrame !== "function") {
        focusEditor();
        return;
      }

      if (promptActionFocusFrameRef.current !== null) {
        cancelAnimationFrame(promptActionFocusFrameRef.current);
      }
      promptActionFocusFrameRef.current = requestAnimationFrame(focusEditor);
    },
    [scheduleRevealEditorSelection, syncTriggerState],
  );

  const applyPromptAction = useCallback(
    (action: PromptBoxAction) => {
      if (action.text.length === 0) return;
      const commandAction = promptActionCommandFromAction(action);

      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) {
        const currentValue = valueRef.current;
        if (currentValue.endsWith(action.text)) return;
        if (commandAction) {
          const start = currentValue.length;
          const nextValue = `${currentValue}${commandAction.serializedText}${commandAction.trailingText}`;
          onChangeRef.current(nextValue, [
            ...mentionRangesRef.current,
            {
              start,
              end: start + commandAction.serializedText.length,
              resource: promptCommandResourceFromSuggestion({
                suggestion: commandAction.suggestion,
                trigger: commandAction.trigger,
              }),
            },
          ]);
        } else {
          onChangeRef.current(`${currentValue}${action.text}`, [
            ...mentionRangesRef.current,
          ]);
        }
        return;
      }

      if (promptActionTextImmediatelyBeforeCursor(currentEditor, action.text)) {
        focusAfterPromptAction(currentEditor);
        return;
      }

      const insertionRange = getPromptActionInsertionRange({
        editor: currentEditor,
        action,
        actions: promptActions ?? [],
        triggers: promptActionTriggers(triggers, commandAction),
      });
      if (insertionRange === null) {
        focusAfterPromptAction(currentEditor);
        return;
      }

      if (commandAction) {
        triggerKeyRef.current = "";
        dismissedTriggerRef.current = null;
        isRestoringAppliedMentionRef.current = true;
        setActiveTrigger(null);
        setSelectedIndex(0);
        onCommandQueryChange(null);

        try {
          skipEditorChangeRef.current = true;
          currentEditor
            .chain()
            .focus()
            .deleteRange({ from: insertionRange.from, to: insertionRange.to })
            .insertContent([
              {
                type: "mention",
                attrs: {
                  resource: promptCommandResourceFromSuggestion({
                    suggestion: commandAction.suggestion,
                    trigger: commandAction.trigger,
                  }),
                  serializedText: commandAction.serializedText,
                },
              },
              ...(commandAction.trailingText
                ? [{ type: "text", text: commandAction.trailingText }]
                : []),
            ])
            .run();
        } finally {
          skipEditorChangeRef.current = false;
        }
        finishApply(currentEditor);
        return;
      }

      triggerKeyRef.current = "";
      dismissedTriggerRef.current = null;
      setSelectedIndex(0);
      currentEditor
        .chain()
        .focus()
        .deleteRange({ from: insertionRange.from, to: insertionRange.to })
        .insertContent(action.text)
        .run();
      finishApply(currentEditor);
    },
    [
      finishApply,
      focusAfterPromptAction,
      onCommandQueryChange,
      promptActions,
      triggers,
    ],
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
    hasSubmittableInput && !isSubmitting && !submitDisabled && !isVoiceBusy;
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
        syncTriggerState(currentEditor);
        scheduleRevealEditorSelection();
      });
    },
    [history, scheduleRevealEditorSelection, syncTriggerState],
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
      const canNavigateTypeahead =
        showTypeaheadMenu && !hasArrowNavigationModifier && !canNavigateHistory;

      if (showTypeaheadMenu) {
        if (
          event.key === "ArrowDown" &&
          canNavigateTypeahead &&
          activeSuggestions.length > 0
        ) {
          event.preventDefault();
          if (
            activeTriggerKind === "command" &&
            !commandError &&
            selectedIndex >= activeSuggestions.length - 1 &&
            (commandHasMore || commandIsLoadingMore)
          ) {
            if (canLoadMoreCommands) {
              loadMoreCommands();
            }
            return true;
          }
          setSelectedIndex((prev) => (prev + 1) % activeSuggestions.length);
          return true;
        }
        if (
          event.key === "ArrowUp" &&
          canNavigateTypeahead &&
          activeSuggestions.length > 0
        ) {
          event.preventDefault();
          setSelectedIndex(
            (prev) =>
              (prev + activeSuggestions.length - 1) % activeSuggestions.length,
          );
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab") &&
          activeSuggestions.length > 0
        ) {
          event.preventDefault();
          const selected =
            activeSuggestions[selectedIndex] ?? activeSuggestions[0];
          if (selected) {
            applyTrigger(selected);
          }
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          triggerKeyRef.current = "";
          if (activeTrigger) {
            // Escape dismisses the typed token span for both kinds — re-trigger
            // stays suppressed while the caret remains inside `[from, to]`.
            dismissedTriggerRef.current = {
              start: activeTrigger.from,
              end: activeTrigger.to,
              hasLeftRange: false,
            };
          }
          setActiveTrigger(null);
          onMentionQueryChange(null);
          onCommandQueryChange(null);
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

      const isBlockquoteExitKey =
        event.key === "Enter" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.ctrlKey;
      if (
        isBlockquoteExitKey &&
        currentEditor &&
        applyPromptListNewline(currentEditor)
      ) {
        event.preventDefault();
        return true;
      }

      if (
        isBlockquoteExitKey &&
        currentEditor &&
        (insertParagraphBeforeBlockquote(currentEditor) ||
          exitTrailingBlockquoteBreak(currentEditor))
      ) {
        event.preventDefault();
        return true;
      }

      const isPromptNewlineKey =
        event.key === "Enter" &&
        !event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        (event.shiftKey || isZenMode || !canSubmitWithEnterKey);
      if (isPromptNewlineKey && currentEditor && exitHeading(currentEditor)) {
        event.preventDefault();
        return true;
      }

      if (
        isPromptNewlineKey &&
        currentEditor &&
        applyPromptParagraphNewline(currentEditor)
      ) {
        event.preventDefault();
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
      activeSuggestions,
      activeTrigger,
      activeTriggerKind,
      applyHistoryDraft,
      applyTrigger,
      canLoadMoreCommands,
      canSubmitWithEnterKey,
      commandError,
      commandHasMore,
      commandIsLoadingMore,
      history,
      isZenMode,
      loadMoreCommands,
      onCommandQueryChange,
      onMentionQueryChange,
      onModifierSubmit,
      resetHistorySession,
      selectedIndex,
      showTypeaheadMenu,
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
        "relative w-full rounded-lg border border-border bg-background pb-2 shadow-lift",
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
                "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror]:outline-none",
                "[&_.ProseMirror_p]:m-0",
                "[&_.ProseMirror_blockquote]:my-1 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-surface-selected-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground",
                // Markdown formatting styles (mirrors what the timeline renders).
                "[&_.ProseMirror_h1]:my-1 [&_.ProseMirror_h1]:text-lg [&_.ProseMirror_h1]:font-semibold",
                "[&_.ProseMirror_h2]:my-1 [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold",
                "[&_.ProseMirror_h3]:my-1 [&_.ProseMirror_h3]:text-sm [&_.ProseMirror_h3]:font-semibold",
                "[&_.ProseMirror_h4]:my-1 [&_.ProseMirror_h4]:text-sm [&_.ProseMirror_h4]:font-semibold [&_.ProseMirror_h5]:font-semibold [&_.ProseMirror_h6]:font-semibold",
                "[&_.ProseMirror_ul]:my-1 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5",
                "[&_.ProseMirror_ol]:my-1 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5",
                "[&_.ProseMirror_li]:my-0.5 [&_.ProseMirror_li>p]:m-0",
                "[&_.ProseMirror_code]:rounded [&_.ProseMirror_code]:bg-surface-selected [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:py-0.5 [&_.ProseMirror_code]:font-mono [&_.ProseMirror_code]:text-[0.9em]",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-subtle-foreground",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:font-light",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:opacity-70",
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
              )}
            />
          </PromptMentionLinkContext.Provider>
        </div>
      </div>

      {showTypeaheadMenu ? (
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
            state={typeaheadMenuState}
            selectedIndex={selectedIndex}
            onApply={applyTrigger}
            onCommandLoadMore={
              canLoadMoreCommands ? loadMoreCommands : undefined
            }
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
          <PromptBoxActionsMenu
            actions={promptActions}
            onAction={applyPromptAction}
          />
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
