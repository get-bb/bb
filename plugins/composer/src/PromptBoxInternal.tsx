import {
  experimental_ComposerRoot as ComposerRoot,
  experimental_FailedVoiceRecordings as FailedVoiceRecordings,
  experimental_Icon as SdkIcon,
  experimental_ShortcutHint as AppCommandShortcutHint,
  experimental_useComposerCommandSearch as useComposerCommandSearch,
  experimental_useComposerContributions as useComposerContributions,
  experimental_useComposerMentionSearch as useComposerMentionSearch,
  experimental_useComposerRenderer as useComposerRenderer,
  useComposer,
  experimental_readPromptMentionClipboard as readPromptMentionClipboard,
  experimental_VoiceInputButton as VoiceInputButton,
  experimental_VoiceRecordingBar as VoiceRecordingBar,
  type ComposerAttachment,
  type ComposerDraft,
  type ComposerDraftSnapshot,
  type ComposerMention,
  type ExperimentalComposerCommandSuggestion,
  type ExperimentalComposerEditor,
  type ExperimentalComposerEditorState,
  type ExperimentalComposerAction,
  type ExperimentalComposerInput,
  type ExperimentalDroppedThreadMention,
  type ExperimentalComposerPromptAction as PromptBoxAction,
} from "@get-bb/plugin-sdk/app";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { CommandManager } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEditor, type Editor } from "@tiptap/react";
import { nanoid } from "nanoid";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  commandPillDismissedRangeEnd,
  findActiveTrigger,
  type ActiveTrigger,
  type TypeaheadTrigger,
} from "./mentions/find-active-trigger";
import {
  attachmentMentionGroup,
  typeaheadSuggestionKey,
  type CommandMenuState,
  type MenuMentionSuggestion,
  type MentionMenuState,
  type TypeaheadMenuState,
  type TypeaheadSuggestion,
} from "./mentions/typeahead-suggestions";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ComposerPopupHost } from "./ComposerPopupHost";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chrome-style-tokens";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import {
  getMediaQuerySnapshot,
  REDUCED_MOTION_QUERY,
} from "@/components/ui/hooks/use-media-query";
import { blurActiveKeyboardInputWithin } from "@/components/ui/overlay-trigger";
import { cn } from "@/lib/utils";
import { AttachmentPreview } from "./AttachmentPreview";
import { areDraftsEqual, isDraftEmpty } from "./composer-draft";
import {
  commandMentionTarget,
  compareMentions,
  mentionInRange,
  sameMention,
  shiftMention,
  type MentionTarget,
} from "./editor/composer-mentions";
import { ComposerPlusMenuSlot } from "./PromptBoxActionsMenu";
import { refreshPromptDecorations } from "./editor/prompt-decoration-extension";
import { promptEditorExtensions } from "./editor/prompt-editor-extensions";
import {
  AttachmentHistory,
  attachmentHistoryTransaction,
} from "./editor/attachment-history";
import {
  cancelPromptThreadLinkPaste,
  createPromptThreadLinkPasteExtension,
  promptThreadLinkPasteKey,
} from "./editor/prompt-thread-link-paste";
import {
  promptEditorClipboardTextFromSlice,
  promptEditorContentFromValue,
  promptEditorCopiedSlice,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
  promptEditorValueFromSlice,
  type PromptEditorMentionAttrs,
  type PromptEditorValue,
} from "./editor/prompt-editor-serialization";
import {
  exitTrailingBlockquoteBreak,
  insertParagraphBeforeBlockquote,
  removeEmptyBlockquotes,
} from "./editor/prompt-editor-blockquote";
import { applyPromptParagraphNewline } from "./editor/prompt-editor-paragraph";
import { MentionMenu } from "./mentions/MentionMenu";
import { useTypeaheadMenuMaxHeight } from "./useTypeaheadMenuMaxHeight";
import {
  findPastedThreadLinkCandidates,
  type ThreadLinkParser,
} from "./mentions/pasted-thread-link-candidates";
import {
  blurPromptEditor,
  COMPOSER_EDITOR_AVAILABLE_HEIGHT_PROPERTY,
  ComposerEditorSlot,
} from "./ComposerEditorSlot";
import { isModifierSubmitKeyEvent } from "./modifier-submit-key";
import { composerSubmittingBlockedReason } from "./composer-submit-gate";

import { ComposerSendMenu } from "./ComposerSendMenu";

const PROMPTBOX_MIN_HEIGHT = 68;
const DEFAULT_MENTION_TRIGGER = "@";
const PROMPTBOX_SELECTION_REVEAL_MARGIN = 12;
const COMPACT_PROMPT_ACTION_BUTTON_CLASS =
  "size-8 p-0 transition-all [&_[data-icon-root]]:size-4 max-md:pointer-coarse:size-10";
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
const RICH_PASTE_LIST_MARKER = "- ";
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

function mentionPillTrailingText(
  doc: ProseMirrorNode,
  position: number,
): string {
  return hasWhitespaceAfterPosition(doc, position) ? "" : " ";
}

const COLLAPSING_GRID_CLASS =
  "grid transition-[grid-template-rows] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";
const VOICE_ACTION_TRANSITION_MS = 180;
const PASTED_TEXT_ATTACHMENT_MIN_LENGTH = 5_000;

function uniqueAttachmentName(
  name: string,
  takenNames: ReadonlySet<string>,
): string {
  const extensionStart = name.lastIndexOf(".");
  const stem = extensionStart > 0 ? name.slice(0, extensionStart) : name;
  const extension = extensionStart > 0 ? name.slice(extensionStart) : "";
  let candidate = name;
  for (let index = 2; takenNames.has(candidate); index += 1) {
    candidate = `${stem} ${index}${extension}`;
  }
  return candidate;
}

function withUniqueAttachmentNames(
  files: readonly File[],
  existingNames: ReadonlySet<string>,
): File[] {
  const takenNames = new Set(existingNames);
  return files.map((file) => {
    const name = uniqueAttachmentName(file.name, takenNames);
    takenNames.add(name);
    return name === file.name
      ? file
      : new File([file], name, {
          type: file.type,
          lastModified: file.lastModified,
        });
  });
}
type VoiceActionTransition = "entering" | "active" | "exiting";

function shouldFinishVoiceCompletionTransitionImmediately(): boolean {
  return (
    getMediaQuerySnapshot(REDUCED_MOTION_QUERY) ||
    (typeof document !== "undefined" && document.visibilityState === "hidden")
  );
}

function suppressTouchCompatibilityClick(ownerDocument: Document) {
  const clear = () => {
    window.clearTimeout(timeout);
    ownerDocument.removeEventListener("click", handleClick, true);
    ownerDocument.removeEventListener("pointerdown", clear, true);
    ownerDocument.removeEventListener("keydown", clear, true);
  };
  const handleClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    clear();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const timeout = window.setTimeout(clear, 1000);
  ownerDocument.addEventListener("click", handleClick, true);
  ownerDocument.addEventListener("pointerdown", clear, true);
  ownerDocument.addEventListener("keydown", clear, true);
}

interface PromptSubmitButtonProps {
  canSubmit: boolean;
  className: string;
  disabledReason: string | undefined;
  icon: string | undefined;
  isBusy: boolean;
  isCompact: boolean;
  label: string | undefined;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTouchSubmit: () => void;
  title: string;
}

function PromptSubmitButton({
  canSubmit,
  className,
  disabledReason,
  icon,
  isBusy,
  isCompact,
  label,
  onClick,
  onPointerDown,
  onTouchSubmit,
  title,
}: PromptSubmitButtonProps) {
  const touchRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const suppressTouchClickRef = useRef(false);
  const button = (
    <Button
      data-promptbox-submit-action=""
      type="submit"
      size={isCompact ? "icon" : "sm"}
      variant="default"
      aria-label={title}
      aria-busy={isBusy}
      disabled={!canSubmit}
      onPointerDown={(event) => {
        suppressTouchClickRef.current = false;
        touchRef.current =
          event.pointerType === "touch" && event.isPrimary && event.button === 0
            ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
            : null;
        onPointerDown(event);
      }}
      onPointerMove={(event) => {
        const touch = touchRef.current;
        if (
          touch &&
          touch.pointerId === event.pointerId &&
          Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10
        ) {
          touchRef.current = null;
          suppressTouchClickRef.current = true;
        }
      }}
      onPointerCancel={() => {
        if (touchRef.current) suppressTouchClickRef.current = true;
        touchRef.current = null;
      }}
      onPointerUp={(event) => {
        const touch = touchRef.current;
        touchRef.current = null;
        if (!touch || touch.pointerId !== event.pointerId) return;
        suppressTouchClickRef.current = true;
        if (!canSubmit) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10 ||
          event.clientX < bounds.left ||
          event.clientX >= bounds.right ||
          event.clientY < bounds.top ||
          event.clientY >= bounds.bottom
        ) {
          return;
        }
        suppressTouchCompatibilityClick(event.currentTarget.ownerDocument);
        onTouchSubmit();
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (suppressTouchClickRef.current && event.detail > 0) {
          event.preventDefault();
          return;
        }
        onClick(event);
      }}
      className={cn(
        className,
        label !== undefined && !isCompact && "size-auto h-8 gap-1.5 px-2.5",
      )}
    >
      {isBusy ? (
        <Icon
          name="Loading"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <>
          <SdkIcon name={icon ?? "CornerDownLeft"} className="size-4" />
          {label !== undefined && !isCompact ? (
            <span data-promptbox-submit-label="">{label}</span>
          ) : null}
        </>
      )}
    </Button>
  );

  if (!disabledReason) return button;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-promptbox-submit-disabled-reason=""
            className="inline-flex shrink-0"
          >
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface AttachmentHistoryEntry {
  attachments: readonly ComposerAttachment[] | null;
  draftKey: string | null;
  positions: number[];
  present: boolean;
}

function recordAttachmentHistory(
  view: EditorView,
  id: string,
  present: boolean,
): void {
  view.dispatch(attachmentHistoryTransaction(view.state.tr, id, present));
  view.dispatch(closeHistory(view.state.tr));
}

function recordPastedTextHistory(
  editor: Editor,
  id: string,
  value: PromptEditorValue,
): void {
  const { view } = editor;
  const insert = closeHistory(view.state.tr);
  const from = view.state.selection.from;
  new CommandManager({ editor })
    .createChain(insert, true)
    .insertContent(promptEditorInlineContentFromValue(value))
    .run();
  const inserted = view.state.applyTransaction(insert).state;
  const replaced = inserted.applyTransaction(
    attachmentHistoryTransaction(
      inserted.tr.delete(insert.mapping.map(from, -1), inserted.selection.from),
      id,
      true,
    ),
  ).state;
  view.updateState(replaced.applyTransaction(closeHistory(replaced.tr)).state);
}

const PROMPT_STACK_EDGE_CARET_BUTTON_WIDTH_CLASS = "w-6 px-0";

type ComposerMenuState =
  | { kind: "suggestions"; trigger: ActiveTrigger }
  | { kind: "plugin"; key: string; open: boolean }
  | null;

interface DismissedTriggerRange {
  start: number;
  end: number;
  hasLeftRange: boolean;
}

interface PromptEditorValueKey {
  text: string;
  mentions: readonly ComposerMention[];
}

interface PromptEditorSelectionRevealArgs {
  editor: Editor;
  scrollContainer: HTMLElement;
}

interface ParsedRichClipboardValue {
  threadLinks: { text: string; literal: boolean }[];
  hasMentions: boolean;
  value: PromptEditorValue;
}

type PromptBoxMouseDownEvent = ReactMouseEvent<HTMLFormElement>;

interface PromptActionInsertionRange {
  from: number;
  to: number;
}

interface PromptActionCommand {
  serializedText: string;
  trailingText: string;
  target: MentionTarget;
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

export function arePromptEditorValuesEqual(
  left: PromptEditorValueKey | null,
  right: PromptEditorValueKey,
): boolean {
  if (left === null) return false;
  if (left.text !== right.text) return false;
  if (left.mentions === right.mentions) return true;
  if (left.mentions.length !== right.mentions.length) return false;
  for (let index = 0; index < left.mentions.length; index += 1) {
    if (!sameMention(left.mentions[index]!, right.mentions[index]!)) {
      return false;
    }
  }
  return true;
}

function normalizePastedPlainText(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

function promptActionCommandMentionsFromText(
  text: string,
  actions: readonly PromptBoxAction[] | undefined,
): ComposerMention[] {
  const mentions: ComposerMention[] = [];

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
        mentions.push(mentionInRange(commandAction.target, start, end));
      }

      searchStart = end;
    }
  }

  return mentions.sort(compareMentions);
}

function mergeMentions(
  baseMentions: readonly ComposerMention[],
  additionalMentions: readonly ComposerMention[],
): ComposerMention[] {
  const merged = [...baseMentions].sort(compareMentions);

  for (const additionalMention of additionalMentions) {
    const overlapsExisting = merged.some(
      (mention) =>
        additionalMention.from < mention.to &&
        additionalMention.to > mention.from,
    );
    if (!overlapsExisting) {
      merged.push(additionalMention);
    }
  }

  return merged.sort(compareMentions);
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
    mentions: mergeMentions(value.mentions, promptActionMentions),
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

function promptEditorSliceHasBlockquote(slice: Slice): boolean {
  let hasBlockquote = false;
  slice.content.descendants((node) => {
    if (node.type.name === "blockquote") {
      hasBlockquote = true;
      return false;
    }
    return true;
  });
  return hasBlockquote;
}

function plainTextHasQuoteLine(text: string): boolean {
  return normalizePastedPlainText(text)
    .split("\n")
    .some((line) => line === ">" || line.startsWith("> "));
}

function trimTrailingPromptNewlines(
  value: PromptEditorValue,
): PromptEditorValue {
  const text = value.text.replace(/\n+$/u, "");
  if (text.length === value.text.length) {
    return value;
  }

  return {
    text,
    mentions: value.mentions.filter((mention) => mention.to <= text.length),
  };
}

function promptEditorValueFromRichHtml(
  html: string,
  parseLink: ThreadLinkParser,
): ParsedRichClipboardValue {
  const document = new DOMParser().parseFromString(html, "text/html");
  let text = "";
  let hasMentions = false;
  let listMarkerPending = false;
  const mentions: ComposerMention[] = [];
  const literalRanges: { from: number; to: number }[] = [];

  const flushListMarker = () => {
    if (!listMarkerPending) {
      return;
    }
    listMarkerPending = false;
    text += RICH_PASTE_LIST_MARKER;
  };

  const appendText = (appendedText: string, literal = false) => {
    if (appendedText.length === 0) {
      return;
    }
    flushListMarker();
    if (literal)
      literalRanges.push({
        from: text.length,
        to: text.length + appendedText.length,
      });
    text += appendedText;
  };

  const appendNewline = () => {
    text = text.replace(/[ \t]+$/u, "");
    if (text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
  };

  const appendCollapsedText = (rawText: string, literal: boolean) => {
    const collapsedText = rawText.replace(/\s+/gu, " ");
    if (collapsedText.trim().length === 0) {
      if (listMarkerPending) {
        return;
      }
      if (text.length > 0 && !/[\s]$/u.test(text)) {
        appendText(" ");
      }
      return;
    }
    appendText(collapsedText, literal);
  };

  const appendClipboardMention = (element: Element): boolean => {
    const pill = readPromptMentionClipboard(element);
    if (!pill) {
      return false;
    }

    flushListMarker();
    const start = text.length;
    appendText(pill.text);
    mentions.push(mentionInRange(pill.mention, start, text.length));
    hasMentions = true;
    return true;
  };

  const visitChildren = (
    node: Node,
    preserveWhitespace: boolean,
    literal = false,
  ) => {
    for (const childNode of node.childNodes) {
      visitNode(childNode, preserveWhitespace, literal);
    }
  };

  const visitNode = (
    node: Node,
    preserveWhitespace: boolean,
    literal: boolean,
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const rawText = node.textContent ?? "";
      if (preserveWhitespace) {
        appendText(normalizePastedPlainText(rawText), literal);
        return;
      }
      appendCollapsedText(rawText, literal);
      return;
    }

    if (!(node instanceof Element)) {
      visitChildren(node, preserveWhitespace, literal);
      return;
    }

    const tagName = node.tagName.toUpperCase();
    literal ||=
      tagName === "CODE" ||
      tagName === "BLOCKQUOTE" ||
      (tagName === "A" &&
        node.getAttribute("href") !== node.textContent?.trim());
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
      appendText(normalizePastedPlainText(node.textContent ?? ""), true);
      appendNewline();
      return;
    }
    if (tagName === "LI") {
      appendNewline();
      listMarkerPending = true;
      visitChildren(node, preserveWhitespace, literal);
      listMarkerPending = false;
      appendNewline();
      return;
    }
    if (RICH_PASTE_BLOCK_TAGS.has(tagName)) {
      appendNewline();
      visitChildren(node, preserveWhitespace, literal);
      appendNewline();
      return;
    }

    visitChildren(node, preserveWhitespace, literal);
  };

  visitChildren(document.body, false);
  const threadLinks = findPastedThreadLinkCandidates({
    text,
    parseLink,
  }).map((link) => ({
    text: link.text,
    literal: literalRanges.some(
      (range) => range.from < link.to && range.to > link.from,
    ),
  }));

  if (hasMentions) {
    const trimmedText = text.replace(/\n+$/u, "");
    return {
      hasMentions,
      threadLinks,
      value: {
        text: trimmedText,
        mentions: mentions.filter(
          (mention) =>
            mention.from >= 0 &&
            mention.to > mention.from &&
            mention.to <= trimmedText.length,
        ),
      },
    };
  }

  return {
    hasMentions,
    threadLinks,
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
  richValue?: ParsedRichClipboardValue | null,
): PromptEditorValue | null {
  if (richValue?.hasMentions) {
    return withPromptActionCommandMentions(richValue.value, promptActions);
  }

  const plainText = clipboardData?.getData("text/plain") ?? "";
  if (plainText.length > 0) {
    return promptEditorValueFromPlainText(plainText, promptActions);
  }

  return richValue?.value ?? null;
}

function runAfterClipboardCut(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }

  setTimeout(callback, 0);
}

function revealPromptEditorSelection({
  editor,
  scrollContainer,
}: PromptEditorSelectionRevealArgs): void {
  const scrollContainerRect = scrollContainer.getBoundingClientRect();
  if (scrollContainerRect.height <= 0) return;

  let selectionRect: ReturnType<Editor["view"]["coordsAtPos"]>;
  try {
    selectionRect = editor.view.coordsAtPos(editor.state.selection.head);
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

function withLeadingCommand(
  value: { text: string; mentions: readonly ComposerMention[] },
  command: PromptActionCommand,
): PromptEditorValue {
  const leadingCommand = value.mentions.find(
    (mention) => mention.kind === "command" && mention.from === 0,
  );
  const rest = value.text.slice(leadingCommand?.to ?? 0).trimStart();
  const prefix = `${command.serializedText}${command.trailingText}`;
  const shift = prefix.length - (value.text.length - rest.length);
  return {
    text: `${prefix}${rest}`,
    mentions: [
      mentionInRange(command.target, 0, command.serializedText.length),
      ...value.mentions
        .filter((mention) => mention !== leadingCommand)
        .map((mention) => shiftMention(mention, shift)),
    ],
  };
}

function skillsTriggerInsertionRange(
  editor: Editor,
  action: PromptBoxAction,
  triggers: readonly TypeaheadTrigger[],
): PromptActionInsertionRange | null {
  const selection = editor.state.selection;
  if (!selection.empty) {
    return { from: selection.from, to: selection.to };
  }
  if (promptActionTextImmediatelyBeforeCursor(editor, action.text)) {
    return null;
  }
  const activeTrigger = findActiveTrigger(editor, triggers);
  if (
    activeTrigger !== null &&
    activeTrigger.kind === "command" &&
    activeTrigger.char === action.text &&
    activeTrigger.to === selection.from
  ) {
    return null;
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
  return {
    serializedText: `${trigger}${name}`,
    trailingText,
    target: commandMentionTarget(
      { name, source: "command", origin: "user", argumentHint: null },
      trigger,
    ),
  };
}

export function suppressPromptEditorAnchorActivation(event: Event): boolean {
  if (!(event.target instanceof Element)) return false;
  if (event.target.closest("a[href]") === null) return false;

  event.preventDefault();
  event.stopPropagation();
  return true;
}

function focusEditorAtEnd(editor: Editor): void {
  const transaction = editor.state.tr
    .setSelection(TextSelection.atEnd(editor.state.doc))
    .scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
}

const SAFARI_POST_COMPOSITION_KEYDOWN_WINDOW_MS = 500;

function isIPadOSWebKit(): boolean {
  if (typeof navigator === "undefined") return false;

  const isAppleWebKit =
    /Apple Computer/u.test(navigator.vendor) &&
    /\bAppleWebKit\//u.test(navigator.userAgent);
  const isIPad =
    navigator.platform === "iPad" ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 2);
  return isAppleWebKit && isIPad;
}

function usePostCompositionKeyDownEvents(): WeakSet<KeyboardEvent> {
  const ref = useRef<WeakSet<KeyboardEvent> | null>(null);
  ref.current ??= new WeakSet<KeyboardEvent>();
  return ref.current;
}

function isIPadHardwareEnterCandidate(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    (event.code === "Enter" || event.code === "NumpadEnter")
  );
}

export function PromptBoxInternal({
  id,
  onEscape,
  placeholder = "Ask anything. @ to mention files, folders, or sections",
  autoFocus = true,
  handoff,
  executionControls,
  compactBeforeSend,
  submission,
  minHeight = PROMPTBOX_MIN_HEIGHT,
  maxHeight,
  mentionTriggers: mentionTriggerChars,
  commandTriggers: commandTriggerChars,
  resolveMentionLink: mentionResolveLink,
  mentionMenuPlacement,
  attachments: attachmentConfig = {},
  promptActions,
  surface,
  onCollapse,
  compact,
  history,
  voice,
}: ExperimentalComposerInput) {
  const compactWhen = compact?.when ?? null;
  const compactPlaceholder = compact?.placeholder;
  const renderer = useComposerRenderer();
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  const composer = useComposer();
  const composerDraft = composer.draft;
  const value = composerDraft.text;
  const mentionRanges = composerDraft.mentions;
  const onChange = useCallback(
    (text: string, mentions: readonly ComposerMention[]) => {
      composer.replace({ text, mentions });
    },
    [composer],
  );
  const focusComposerShortcut = renderer.focusComposerShortcut;
  const {
    isSubmitting = false,
    disabled: submitDisabled = false,
    disabledReason: submitDisabledReason,
    label: submitLabel,
    icon: submitIcon,
    title: submitTitle = "Submit (Enter)",
    isRunning = false,
    onStop,
    enter: primarySubmitAction,
    modifier: modifierSubmitAction,
    showModifierInMenu,
  } = submission;
  const onSubmit = primarySubmitAction.run;
  const onModifierSubmit = modifierSubmitAction?.run;
  const {
    items: attachments = [],
    pendingUploads,
    isAttaching = false,
    error: attachmentError = null,
    onAttachFiles,
    onUpdate: onUpdateAttachments,
    projectId: attachmentProjectId,
  } = attachmentConfig;
  const isPointerCoarse = usePointerCoarse();
  const isCompactViewport = useIsCompactViewport();
  const blurOnPointerSubmit =
    surface === "thread" && isCompactViewport && isPointerCoarse;
  const isIPadOSWebKitDevice = useMemo(isIPadOSWebKit, []);
  const editorEnterKeyHint = isPointerCoarse ? "enter" : "send";
  const formRef = useRef<HTMLFormElement>(null);
  const typeaheadMenuRef = useRef<HTMLDivElement>(null);
  const blurAfterPointerSubmitRef = useRef(false);
  const lastObservedHeightRef = useRef<number | null>(null);
  useEffect(() => {
    const formElement = formRef.current;
    if (!formElement || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      lastObservedHeightRef.current =
        formElement.getBoundingClientRect().height;
    });
    observer.observe(formElement);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const formElement = formRef.current;
    const scrollElement = editorScrollContainerRef.current;
    if (!formElement || !scrollElement) return;
    if (maxHeight === undefined) {
      formElement.style.removeProperty(
        COMPOSER_EDITOR_AVAILABLE_HEIGHT_PROPERTY,
      );
      return;
    }
    const capEditor = () => {
      const chromeHeight =
        formElement.offsetHeight - scrollElement.offsetHeight;
      formElement.style.setProperty(
        COMPOSER_EDITOR_AVAILABLE_HEIGHT_PROPERTY,
        `${maxHeight - chromeHeight}px`,
      );
    };
    capEditor();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(capEditor);
    observer.observe(formElement);
    return () => observer.disconnect();
  }, [maxHeight]);
  useLayoutEffect(() => {
    const formElement = formRef.current;
    if (!formElement) return;
    if (compactPlaceholder === undefined) {
      formElement.style.removeProperty(
        "--promptbox-container-compact-placeholder",
      );
      return;
    }
    formElement.style.setProperty(
      "--promptbox-container-compact-placeholder",
      JSON.stringify(compactPlaceholder),
    );
  }, [compactPlaceholder]);
  const editorRef = useRef<Editor | null>(null);
  const pasteWithoutFormattingRef = useRef(false);
  const editorScrollContainerRef = useRef<HTMLDivElement>(null);
  const revealSelectionFrameRef = useRef<number | null>(null);
  const promptActionFocusFrameRef = useRef<number | null>(null);
  const pendingFocusEndRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const mentionRangesRef = useRef<readonly ComposerMention[]>(mentionRanges);
  const placeholderRef = useRef(placeholder);
  const skipEditorChangeRef = useRef(false);
  const lastSyncedEditorValueRef = useRef<PromptEditorValueKey | null>(null);
  const triggerKeyRef = useRef("");
  const handleEditorKeyDownRef = useRef<
    (event: KeyboardEvent, isOriginalIPadHardwareEnter?: boolean) => boolean
  >(() => false);
  const compositionEndedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const postCompositionKeyDownEvents = usePostCompositionKeyDownEvents();
  const dispatchAppCommandKey = renderer.dispatchAppCommandKey;
  const syncTriggerStateRef = useRef<(editor: Editor) => void>(() => {});
  const onAttachFilesRef = useRef(onAttachFiles);
  const attachmentNamesRef = useRef<ReadonlySet<string>>(new Set());
  const attachmentItemsRef = useRef<readonly ComposerAttachment[]>([]);
  const onUpdateAttachmentsRef = useRef(onUpdateAttachments);
  const attachmentDraftKeyRef = useRef<string | null>(null);
  const attachmentHistoryRef = useRef(
    new Map<string, AttachmentHistoryEntry>(),
  );
  const setAttachmentPresenceRef = useRef<
    (id: string, present: boolean) => void
  >(() => {});
  const attachFilesWithHistoryRef = useRef<
    (
      files: File[],
      recordHistory?: (id: string, editor: Editor) => void,
    ) => void
  >(() => {});
  const dismissedTriggerRef = useRef<DismissedTriggerRange | null>(null);
  const isRestoringAppliedMentionRef = useRef(false);
  const [composerMenu, setComposerMenuState] =
    useState<ComposerMenuState>(null);
  const composerMenuRef = useRef<ComposerMenuState>(null);
  const mentionSearch = useComposerMentionSearch();
  const commandSearch = useComposerCommandSearch();
  const searchRef = useRef({
    mention: mentionSearch.search,
    command: commandSearch.search,
  });
  useEffect(() => {
    searchRef.current = {
      mention: mentionSearch.search,
      command: commandSearch.search,
    };
  });
  const setComposerMenu = useCallback((next: ComposerMenuState) => {
    composerMenuRef.current = next;
    setComposerMenuState(next);
    const trigger = next?.kind === "suggestions" ? next.trigger : null;
    searchRef.current.mention(
      trigger?.kind === "mention"
        ? { text: trigger.query, trigger: trigger.char }
        : null,
    );
    searchRef.current.command(
      trigger?.kind === "command"
        ? { text: trigger.query, trigger: trigger.char }
        : null,
    );
  }, []);
  const activeTrigger =
    composerMenu?.kind === "suggestions" ? composerMenu.trigger : null;
  const mentionGroups = mentionSearch.groups;
  const mentionLoading = mentionSearch.status === "loading";
  const mentionRefreshing = mentionSearch.refreshing;
  const mentionError = mentionSearch.status === "error";
  const commandGroups = commandSearch.groups;
  const commandLoading = commandSearch.status === "loading";
  const commandRefreshing = commandSearch.refreshing;
  const commandError = commandSearch.status === "error";
  const [selectedSuggestionKey, setSelectedSuggestionKey] = useState<
    string | null
  >(null);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number | null>(
    null,
  );
  const [temporaryHistoryDraft, setTemporaryHistoryDraft] =
    useState<ComposerDraftSnapshot | null>(null);
  const [recalledHistoryDraft, setRecalledHistoryDraft] =
    useState<ComposerDraftSnapshot | null>(null);
  const hasActiveHistorySessionRef = useRef(false);
  const isVoiceRecording = voice?.state === "recording";
  const isVoiceProcessing = voice?.state === "transcribing";
  const showVoiceActionGroup = isVoiceRecording || isVoiceProcessing;
  const voiceActionState = isVoiceRecording
    ? "recording"
    : isVoiceProcessing
      ? "transcribing"
      : null;
  const lastVoiceActionStateRef = useRef<"recording" | "transcribing">(
    voiceActionState ?? "recording",
  );
  const renderedVoiceActionState =
    voiceActionState ?? lastVoiceActionStateRef.current;
  useLayoutEffect(() => {
    if (voiceActionState !== null) {
      lastVoiceActionStateRef.current = voiceActionState;
    }
  }, [voiceActionState]);
  const [isVoiceActionPresent, setIsVoiceActionPresent] =
    useState(showVoiceActionGroup);
  const [voiceActionTransition, setVoiceActionTransition] =
    useState<VoiceActionTransition>(
      showVoiceActionGroup ? "active" : "exiting",
    );
  const isVoiceActionVisible = voiceActionTransition === "active";
  const wasVoiceActionShownRef = useRef(showVoiceActionGroup);
  const voiceActionRevealFrameRef = useRef<number | null>(null);
  const voiceActionRemovalTimeoutRef = useRef<number | null>(null);
  const voiceCompletionTimeoutRef = useRef<number | null>(null);
  const voiceCompletionPromiseRef = useRef<Promise<void> | null>(null);
  const voiceCompletionResolveRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const wasVoiceActionShown = wasVoiceActionShownRef.current;
    wasVoiceActionShownRef.current = showVoiceActionGroup;
    if (voiceActionRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceActionRevealFrameRef.current);
      voiceActionRevealFrameRef.current = null;
    }
    if (voiceActionRemovalTimeoutRef.current !== null) {
      window.clearTimeout(voiceActionRemovalTimeoutRef.current);
      voiceActionRemovalTimeoutRef.current = null;
    }

    if (showVoiceActionGroup) {
      setIsVoiceActionPresent(true);
      if (wasVoiceActionShown || getMediaQuerySnapshot(REDUCED_MOTION_QUERY)) {
        setVoiceActionTransition("active");
        return;
      }
      setVoiceActionTransition("entering");
      voiceActionRevealFrameRef.current = window.requestAnimationFrame(() => {
        voiceActionRevealFrameRef.current = null;
        setVoiceActionTransition("active");
      });
      return;
    }

    setVoiceActionTransition("exiting");
    if (!wasVoiceActionShown) {
      setIsVoiceActionPresent(false);
      return;
    }
    if (getMediaQuerySnapshot(REDUCED_MOTION_QUERY)) {
      setIsVoiceActionPresent(false);
      return;
    }
    voiceActionRemovalTimeoutRef.current = window.setTimeout(() => {
      voiceActionRemovalTimeoutRef.current = null;
      setIsVoiceActionPresent(false);
    }, VOICE_ACTION_TRANSITION_MS);
  }, [showVoiceActionGroup]);

  useEffect(
    () => () => {
      if (voiceActionRevealFrameRef.current !== null) {
        window.cancelAnimationFrame(voiceActionRevealFrameRef.current);
      }
      if (voiceActionRemovalTimeoutRef.current !== null) {
        window.clearTimeout(voiceActionRemovalTimeoutRef.current);
      }
      if (voiceCompletionTimeoutRef.current !== null) {
        window.clearTimeout(voiceCompletionTimeoutRef.current);
      }
      voiceCompletionResolveRef.current?.();
    },
    [],
  );

  const playVoiceCompletionTransition = useCallback((): Promise<void> => {
    if (voiceActionRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceActionRevealFrameRef.current);
      voiceActionRevealFrameRef.current = null;
    }
    setVoiceActionTransition("exiting");
    if (shouldFinishVoiceCompletionTransitionImmediately()) {
      if (voiceCompletionTimeoutRef.current !== null) {
        window.clearTimeout(voiceCompletionTimeoutRef.current);
        voiceCompletionTimeoutRef.current = null;
      }
      const resolvePendingTransition = voiceCompletionResolveRef.current;
      voiceCompletionPromiseRef.current = null;
      voiceCompletionResolveRef.current = null;
      resolvePendingTransition?.();
      return Promise.resolve();
    }
    if (voiceCompletionPromiseRef.current) {
      return voiceCompletionPromiseRef.current;
    }

    const transition = new Promise<void>((resolve) => {
      voiceCompletionResolveRef.current = resolve;
      voiceCompletionTimeoutRef.current = window.setTimeout(() => {
        voiceCompletionTimeoutRef.current = null;
        voiceCompletionPromiseRef.current = null;
        voiceCompletionResolveRef.current = null;
        resolve();
      }, VOICE_ACTION_TRANSITION_MS);
    });
    voiceCompletionPromiseRef.current = transition;
    return transition;
  }, []);
  const showCompactLayout =
    compact?.when === "always" &&
    (!showVoiceActionGroup ||
      (value.trim().length === 0 &&
        attachments.length === 0 &&
        !pendingUploads?.length));
  const effectivePlaceholder = showCompactLayout
    ? compact.placeholder
    : placeholder;
  const composerKey = renderer.key;
  const composerInputLocked = renderer.inputLocked;
  const composerLayout = showCompactLayout ? "compact" : "expanded";
  const composerView = renderer.view;
  const composerScopeKey = JSON.stringify(composerView.scope);
  const decorationSources = renderer.decorationSources;
  const decorationSourcesRef = useRef(decorationSources);
  decorationSourcesRef.current = decorationSources;
  const focusScopeKey = history?.resetKey;
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onAttachFilesRef.current = onAttachFiles;
  }, [onAttachFiles]);

  useEffect(() => {
    attachmentItemsRef.current = attachments;
    attachmentNamesRef.current = new Set([
      ...attachments.map((attachment) => attachment.name),
      ...(pendingUploads ?? []).map((upload) => upload.file.name),
    ]);
  }, [attachments, pendingUploads]);

  useEffect(() => {
    onUpdateAttachmentsRef.current = onUpdateAttachments;
  }, [onUpdateAttachments]);

  useEffect(() => {
    attachmentDraftKeyRef.current = composerKey;
  }, [composerKey]);

  const removeHistoryAttachments = useCallback(
    (
      entry: AttachmentHistoryEntry,
      attachments: readonly ComposerAttachment[],
    ) => {
      const update = onUpdateAttachmentsRef.current;
      if (!update || attachments.length === 0) return;
      const paths = new Set(attachments.map((attachment) => attachment.path));
      entry.positions = attachments.map((attachment) =>
        attachmentItemsRef.current.findIndex(
          (item) => item.path === attachment.path,
        ),
      );
      update((current) => current.filter((item) => !paths.has(item.path)));
    },
    [],
  );

  const restoreHistoryAttachments = useCallback(
    (
      entry: AttachmentHistoryEntry,
      attachments: readonly ComposerAttachment[],
    ) => {
      const update = onUpdateAttachmentsRef.current;
      if (!update || attachments.length === 0) return;
      const restored = attachments
        .map((attachment, index) => ({
          attachment,
          position: entry.positions[index] ?? -1,
        }))
        .sort((left, right) => left.position - right.position);
      update((current) => {
        const next = current.filter(
          (item) =>
            !restored.some(({ attachment }) => attachment.path === item.path),
        );
        for (const { attachment, position } of restored) {
          next.splice(
            position < 0 ? next.length : Math.min(position, next.length),
            0,
            attachment,
          );
        }
        return next;
      });
    },
    [],
  );

  const setAttachmentPresence = useCallback(
    (id: string, present: boolean) => {
      const entry = attachmentHistoryRef.current.get(id);
      if (
        !entry ||
        entry.present === present ||
        entry.draftKey !== attachmentDraftKeyRef.current
      )
        return;
      entry.present = present;
      if (entry.attachments === null) return;
      if (present) restoreHistoryAttachments(entry, entry.attachments);
      else removeHistoryAttachments(entry, entry.attachments);
    },
    [removeHistoryAttachments, restoreHistoryAttachments],
  );

  const attachFilesWithHistory = useCallback(
    (files: File[], recordHistory?: (id: string, editor: Editor) => void) => {
      const attach = onAttachFilesRef.current;
      if (!attach || files.length === 0) return;
      const id = nanoid();
      const entry: AttachmentHistoryEntry = {
        attachments: null,
        draftKey: attachmentDraftKeyRef.current,
        positions: [],
        present: true,
      };
      attachmentHistoryRef.current.set(id, entry);
      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        if (recordHistory) recordHistory(id, currentEditor);
        else recordAttachmentHistory(currentEditor.view, id, true);
      }
      void attach(
        withUniqueAttachmentNames(files, attachmentNamesRef.current),
      ).then((added) => {
        entry.attachments = added;
        if (!entry.present) removeHistoryAttachments(entry, added);
      });
    },
    [removeHistoryAttachments],
  );

  const removeAttachment = useCallback(
    (path: string) => {
      const attachment = attachmentItemsRef.current.find(
        (item) => item.path === path,
      );
      if (!attachment) return;
      const id = nanoid();
      const entry: AttachmentHistoryEntry = {
        attachments: [attachment],
        draftKey: attachmentDraftKeyRef.current,
        positions: [],
        present: false,
      };
      attachmentHistoryRef.current.set(id, entry);
      removeHistoryAttachments(entry, [attachment]);
      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        recordAttachmentHistory(currentEditor.view, id, false);
      }
    },
    [removeHistoryAttachments],
  );

  useEffect(() => {
    setAttachmentPresenceRef.current = setAttachmentPresence;
    attachFilesWithHistoryRef.current = attachFilesWithHistory;
  }, [attachFilesWithHistory, setAttachmentPresence]);

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

  const triggers = useMemo<TypeaheadTrigger[]>(() => {
    const mentionTriggers = mentionTriggerChars.map((char) => ({
      char,
      kind: "mention" as const,
    }));
    if (commandTriggerChars.length === 0) {
      return mentionTriggers;
    }
    return [
      ...mentionTriggers,
      ...commandTriggerChars.map((char) => ({
        char,
        kind: "command" as const,
      })),
    ];
  }, [commandTriggerChars, mentionTriggerChars]);

  const dismissComposerMenu = useCallback(
    (restoreFocus = false) => {
      const current = composerMenuRef.current;
      triggerKeyRef.current = "";
      if (current?.kind === "suggestions") {
        dismissedTriggerRef.current = {
          start: current.trigger.from,
          end: current.trigger.to,
          hasLeftRange: false,
        };
      }
      setComposerMenu(
        current?.kind === "plugin" ? { ...current, open: false } : null,
      );
      const currentEditor = editorRef.current;
      if (
        restoreFocus &&
        currentEditor &&
        !currentEditor.isDestroyed &&
        !currentEditor.isFocused
      )
        currentEditor.commands.focus();
    },
    [setComposerMenu],
  );

  const syncTriggerState = useCallback(
    (editor: Editor) => {
      if (
        composerMenuRef.current?.kind === "plugin" &&
        composerMenuRef.current.open
      )
        return;
      const caretPosition = editor.state.selection.from;
      let dismissedTrigger = dismissedTriggerRef.current;
      const isRestoringAppliedMention =
        isRestoringAppliedMentionRef.current && dismissedTrigger !== null;
      const detectedTrigger = findActiveTrigger(editor, triggers);
      if (dismissedTrigger && !isRestoringAppliedMention) {
        if (
          !dismissedTrigger.hasLeftRange &&
          detectedTrigger?.from === dismissedTrigger.start
        ) {
          dismissedTrigger = {
            ...dismissedTrigger,
            end: Math.max(dismissedTrigger.end, caretPosition),
          };
          dismissedTriggerRef.current = dismissedTrigger;
        }
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

      const nextTrigger = shouldSuppressTrigger ? null : detectedTrigger;
      const nextKey = nextTrigger
        ? `${nextTrigger.kind}:${nextTrigger.from}:${nextTrigger.to}:${nextTrigger.query}`
        : "";
      if (nextKey !== triggerKeyRef.current) {
        triggerKeyRef.current = nextKey;
        setSelectedSuggestionKey(null);
      }
      setComposerMenu(
        nextTrigger
          ? { kind: "suggestions", trigger: nextTrigger }
          : composerMenuRef.current?.kind === "plugin"
            ? composerMenuRef.current
            : null,
      );
    },
    [setComposerMenu, triggers],
  );

  useEffect(() => {
    syncTriggerStateRef.current = syncTriggerState;
  }, [syncTriggerState]);

  const editorExtensions = useMemo(
    () => [
      ...promptEditorExtensions({
        getPlaceholder: () => placeholderRef.current,
        getDecorationSources: () => decorationSourcesRef.current,
      }),
      createPromptThreadLinkPasteExtension({
        parseLink: (url) => rendererRef.current.threadLinks.parse(url),
        getCachedThread: (threadId) =>
          rendererRef.current.threadLinks.cached(threadId),
        resolveThreads: (threadIds, signal, onBatch) =>
          rendererRef.current.threadLinks.resolve(threadIds, signal, onBatch),
      }),
      AttachmentHistory.configure({
        onChange: (id, present) =>
          setAttachmentPresenceRef.current(id, present),
      }),
    ],
    [],
  );

  const initialEditorContent = useMemo(() => {
    const initialValue: PromptEditorValueKey = {
      text: value,
      mentions: mentionRanges,
    };
    return {
      value: initialValue,
      content: promptEditorContentFromValue(initialValue),
    };
    // oxlint-disable-next-line react/exhaustive-deps -- value/mentionRanges are read once per editor instance on purpose (see above).
  }, []);

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: initialEditorContent.content,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          "aria-label": effectivePlaceholder,
          "data-placeholder": effectivePlaceholder,
          ...(modifierSubmitAction
            ? {
                "aria-keyshortcuts":
                  modifierSubmitAction.shortcut.ariaKeyshortcuts,
              }
            : {}),
          autocomplete: "off",
          class: cn(
            "min-h-full whitespace-pre-wrap break-words outline-none",
            "placeholder:select-none placeholder:text-subtle-foreground",
          ),
          enterkeyhint: editorEnterKeyHint,
          ...(id ? { id } : {}),
          role: "textbox",
        },
        transformCopied: (slice, view) =>
          promptEditorCopiedSlice(slice, view.state.selection),
        clipboardTextSerializer: (slice, view) =>
          promptEditorClipboardTextFromSlice(slice, view.state.schema),
        handleDOMEvents: {
          auxclick: (_view, event) => {
            return suppressPromptEditorAnchorActivation(event);
          },
          focus: () => {
            if (composerMenuRef.current?.kind === "plugin")
              dismissComposerMenu();
            return false;
          },
          blur: () => {
            pasteWithoutFormattingRef.current = false;
            if (composerMenuRef.current?.kind === "suggestions")
              dismissComposerMenu();
            if (dismissedTriggerRef.current) {
              dismissedTriggerRef.current = {
                ...dismissedTriggerRef.current,
                hasLeftRange: true,
              };
            }
            return false;
          },
          cut: () => {
            runAfterClipboardCut(() => {
              const currentEditor = editorRef.current;
              if (!currentEditor || currentEditor.isDestroyed) return;
              removeEmptyBlockquotes(currentEditor);
            });
            return false;
          },
          compositionend: (_view, event) => {
            if (!_view.composing) return false;
            compositionEndedAtRef.current = event.timeStamp;
            return false;
          },
          keydown: (_view, event) => {
            pasteWithoutFormattingRef.current =
              (event.metaKey || event.ctrlKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === "v";
            if (
              !_view.editable ||
              !isIPadOSWebKitDevice ||
              !isIPadHardwareEnterCandidate(event) ||
              _view.composing ||
              event.isComposing ||
              event.keyCode === 229
            ) {
              return false;
            }

            if (
              Math.abs(event.timeStamp - compositionEndedAtRef.current) <
              SAFARI_POST_COMPOSITION_KEYDOWN_WINDOW_MS
            ) {
              compositionEndedAtRef.current = Number.NEGATIVE_INFINITY;
              postCompositionKeyDownEvents.add(event);
              return false;
            }

            return handleEditorKeyDownRef.current(event, true);
          },
          keyup: () => {
            pasteWithoutFormattingRef.current = false;
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
        handlePaste: (view, event, slice) => {
          const skipThreadLinks = pasteWithoutFormattingRef.current;
          pasteWithoutFormattingRef.current = false;
          const html = event.clipboardData?.getData("text/html") ?? "";
          const parseLink: ThreadLinkParser = (url) =>
            rendererRef.current.threadLinks.parse(url);
          const richClipboard = html.trim()
            ? promptEditorValueFromRichHtml(html, parseLink)
            : null;
          const threadLinkMetadata = (pastedValue: PromptEditorValue) => {
            const links = richClipboard?.threadLinks ?? [];
            if (!links.some((link) => link.literal))
              return { skip: skipThreadLinks };
            const pastedLinks = findPastedThreadLinkCandidates({
              text: pastedValue.text,
              parseLink,
            });
            if (
              pastedLinks.length !== links.length ||
              pastedLinks.some(
                (link, index) => link.text !== links[index]?.text,
              )
            )
              return { skip: true };
            return {
              skip: skipThreadLinks,
              literalLinkIndexes: links.flatMap((link, index) =>
                link.literal ? [index] : [],
              ),
            };
          };
          const attachFiles = onAttachFilesRef.current;
          const clipboardItems = Array.from(event.clipboardData?.items ?? []);
          const pastedFiles = clipboardItems
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);

          const copiedMessage = skipThreadLinks
            ? null
            : rendererRef.current.clipboard.readMessage(html);
          if (copiedMessage) {
            event.preventDefault();
            editorRef.current
              ?.chain()
              .focus()
              .insertContent(
                promptEditorInlineContentFromValue({
                  text: copiedMessage.text,
                  mentions: [],
                }),
              )
              .setMeta("uiEvent", "paste")
              .setMeta(promptThreadLinkPasteKey, { skip: skipThreadLinks })
              .run();
            if (attachFiles) {
              if (pastedFiles.length > 0) {
                attachFilesWithHistoryRef.current(pastedFiles);
              } else {
                const editor = editorRef.current;
                const href = window.location.href;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 30000);
                void rendererRef.current.clipboard
                  .readMessageImage(copiedMessage.imageUrl, controller.signal)
                  .then((file) => {
                    if (
                      editor &&
                      !editor.isDestroyed &&
                      editorRef.current === editor &&
                      window.location.href === href
                    )
                      attachFilesWithHistoryRef.current([file]);
                  })
                  .catch(() => {
                    if (
                      editor &&
                      !editor.isDestroyed &&
                      editorRef.current === editor &&
                      window.location.href === href
                    )
                      rendererRef.current.showError(
                        "The copied image could not be attached",
                      );
                  })
                  .finally(() => clearTimeout(timer));
              }
            }
            return true;
          }

          const plainText = event.clipboardData?.getData("text/plain") ?? "";
          if (attachFiles && pastedFiles.length > 0) {
            event.preventDefault();
            attachFilesWithHistoryRef.current(pastedFiles);
          } else if (
            attachFiles &&
            plainText.length >= PASTED_TEXT_ATTACHMENT_MIN_LENGTH
          ) {
            event.preventDefault();
            const file = new File([plainText], "Pasted text.txt", {
              type: "text/plain",
            });
            attachFilesWithHistoryRef.current([file], (id, currentEditor) => {
              const previousDoc = currentEditor.state.doc;
              recordPastedTextHistory(
                currentEditor,
                id,
                promptEditorValueFromPlainText(plainText, promptActions),
              );
              if (currentEditor.state.doc.eq(previousDoc)) return;
              const nextValue = trimTrailingPromptNewlines(
                promptEditorValueFromDoc(currentEditor.state.doc),
              );
              lastSyncedEditorValueRef.current = nextValue;
              onChangeRef.current(nextValue.text, nextValue.mentions);
            });
            view.focus();
            return true;
          }

          const sliceHasBlockquote = promptEditorSliceHasBlockquote(slice);
          if (sliceHasBlockquote || plainTextHasQuoteLine(plainText)) {
            event.preventDefault();
            const pastedValue = trimTrailingPromptNewlines(
              sliceHasBlockquote
                ? promptEditorValueFromSlice(slice, view.state.schema)
                : promptEditorValueFromPlainText(plainText, promptActions),
            );
            if (pastedValue.text.length === 0) return true;

            const currentEditor = editorRef.current;
            const pastedContent =
              promptEditorContentFromValue(pastedValue).content ?? [];
            currentEditor
              ?.chain()
              .focus()
              .insertContent(pastedContent)
              .setMeta("uiEvent", "paste")
              .setMeta(
                promptThreadLinkPasteKey,
                threadLinkMetadata(pastedValue),
              )
              .run();
            if (currentEditor && !currentEditor.isDestroyed) {
              const nextValue = trimTrailingPromptNewlines(
                promptEditorValueFromDoc(currentEditor.state.doc),
              );
              lastSyncedEditorValueRef.current = nextValue;
              onChangeRef.current(nextValue.text, nextValue.mentions);
            }
            return true;
          }

          const pastedValue = promptEditorValueFromClipboardPaste(
            event.clipboardData ?? null,
            promptActions,
            richClipboard,
          );
          if (pastedValue === null) {
            return attachFiles !== undefined && pastedFiles.length > 0;
          }

          event.preventDefault();
          if (pastedValue.text.length === 0) return true;

          editorRef.current
            ?.chain()
            .focus()
            .insertContent(promptEditorInlineContentFromValue(pastedValue))
            .setMeta("uiEvent", "paste")
            .setMeta(promptThreadLinkPasteKey, threadLinkMetadata(pastedValue))
            .run();
          return true;
        },
      },
      onCreate({ editor: createdEditor }) {
        editorRef.current = createdEditor;
        lastSyncedEditorValueRef.current = initialEditorContent.value;
      },
      onSelectionUpdate({ editor: updatedEditor, transaction }) {
        if (transaction.docChanged) return;
        syncTriggerStateRef.current(updatedEditor);
        scheduleRevealEditorSelection();
      },
      onUpdate({ editor: updatedEditor, transaction }) {
        if (skipEditorChangeRef.current) return;
        const dismissedTrigger = dismissedTriggerRef.current;
        if (
          dismissedTrigger !== null &&
          transaction.docChanged &&
          !isRestoringAppliedMentionRef.current
        ) {
          const mappedStart = transaction.mapping.mapResult(
            dismissedTrigger.start,
            1,
          );
          dismissedTriggerRef.current = mappedStart.deleted
            ? null
            : {
                ...dismissedTrigger,
                start: mappedStart.pos,
                end: transaction.mapping.map(dismissedTrigger.end, -1),
              };
        }
        const nextValue = promptEditorValueFromDoc(updatedEditor.state.doc);
        lastSyncedEditorValueRef.current = nextValue;
        onChangeRef.current(nextValue.text, nextValue.mentions);
        syncTriggerStateRef.current(updatedEditor);
        if (transaction.getMeta("uiEvent") !== undefined) {
          scheduleRevealEditorSelection();
        }
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const editable = !composerInputLocked && !showVoiceActionGroup;
    if (editor.isEditable !== editable) editor.setEditable(editable);
    editor.view.dom.tabIndex = editable ? 0 : -1;
    if (editable) {
      editor.view.dom.removeAttribute("aria-readonly");
    } else {
      editor.view.dom.setAttribute("aria-readonly", "true");
    }
  }, [composerInputLocked, editor, showVoiceActionGroup]);

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (editor) cancelPromptThreadLinkPaste(editor);
  }, [editor, composerScopeKey, composerKey, focusScopeKey]);

  useLayoutEffect(() => {
    if (editor && (isSubmitting || composerInputLocked)) {
      cancelPromptThreadLinkPaste(editor);
    }
  }, [editor, isSubmitting, composerInputLocked]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    refreshPromptDecorations(editor);
  }, [composerScopeKey, decorationSources, editor]);

  useLayoutEffect(() => {
    if (!pendingFocusEndRef.current) return;

    if (isPointerCoarse) {
      pendingFocusEndRef.current = false;
      return;
    }
    if (!editor) return;
    pendingFocusEndRef.current = false;
    focusEditorAtEnd(editor);
    scheduleRevealEditorSelection();
  }, [editor, isPointerCoarse, scheduleRevealEditorSelection]);

  useLayoutEffect(() => {
    placeholderRef.current = effectivePlaceholder;
    if (!editor) return;

    editor.view.dom.setAttribute("aria-label", effectivePlaceholder);
    editor.view.dom.setAttribute("data-placeholder", effectivePlaceholder);
    editor.view.dom.setAttribute("enterkeyhint", editorEnterKeyHint);
    editor.view.dispatch(editor.state.tr);
  }, [editor, editorEnterKeyHint, effectivePlaceholder]);

  useEffect(() => {
    if (!editor) return;
    if (!autoFocus) {
      if (editor.view.dom.contains(document.activeElement)) {
        blurPromptEditor(editor);
      }
      return;
    }
    if (isPointerCoarse) return;

    const focusEditor = () => {
      if (editor.isDestroyed) return;
      if (document.activeElement?.closest("[data-sidebar-rename-editor]"))
        return;
      focusEditorAtEnd(editor);
      scheduleRevealEditorSelection();
    };

    if (typeof window.requestAnimationFrame !== "function") {
      focusEditor();
      return;
    }

    const handle = window.requestAnimationFrame(focusEditor);
    return () => window.cancelAnimationFrame(handle);
  }, [
    autoFocus,
    editor,
    focusScopeKey,
    scheduleRevealEditorSelection,
    isPointerCoarse,
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
    if (
      arePromptEditorValuesEqual(lastSyncedEditorValueRef.current, nextValue)
    ) {
      return;
    }

    dismissedTriggerRef.current = null;
    triggerKeyRef.current = "";

    try {
      skipEditorChangeRef.current = true;
      cancelPromptThreadLinkPaste(editor);
      editor.commands.setContent(promptEditorContentFromValue(nextValue));
      lastSyncedEditorValueRef.current = nextValue;
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

  useLayoutEffect(() => {
    scheduleRevealEditorSelection();
  }, [minHeight, scheduleRevealEditorSelection]);

  const resetHistorySession = useCallback(() => {
    if (!hasActiveHistorySessionRef.current) return;
    hasActiveHistorySessionRef.current = false;
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
      !areDraftsEqual(activeHistoryEntry, recalledHistoryDraft)
    ) {
      resetHistorySession();
      return;
    }
    if (areDraftsEqual(history.currentDraft, recalledHistoryDraft)) {
      return;
    }
    resetHistorySession();
  }, [activeHistoryIndex, history, recalledHistoryDraft, resetHistorySession]);

  useLayoutEffect(() => {
    const fromHeight = lastObservedHeightRef.current;
    const formElement = formRef.current;
    if (fromHeight === null || !formElement) return;
    if (getMediaQuerySnapshot(REDUCED_MOTION_QUERY)) return;

    const previousTransition = formElement.style.transition;
    const previousWillChange = formElement.style.willChange;
    const previousOverflow = formElement.style.overflow;

    formElement.style.transition = "none";
    formElement.style.height = "";
    const toHeight = formElement.getBoundingClientRect().height;
    if (Math.abs(toHeight - fromHeight) < 0.5) {
      formElement.style.transition = previousTransition;
      return;
    }
    formElement.style.height = `${fromHeight}px`;
    formElement.getBoundingClientRect();
    formElement.style.overflow = "hidden";
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
      formElement.style.overflow = previousOverflow;
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
  }, [compactWhen, showCompactLayout]);

  const trimmedValue = value.trim();
  const hasAttachments = attachments.length > 0;
  const hasSubmittableInput = trimmedValue.length > 0 || hasAttachments;

  const activeTriggerKind = activeTrigger?.kind ?? null;
  const orderedCommandSuggestions = useMemo(
    () => commandGroups.flatMap((group) => group.suggestions),
    [commandGroups],
  );
  const activeMentionQuery =
    activeTrigger?.kind === "mention" ? activeTrigger.query.trim() : "";
  const isDefaultMentionTrigger =
    activeTrigger?.kind === "mention" &&
    activeTrigger.char === DEFAULT_MENTION_TRIGGER;
  const attachmentGroup = useMemo(
    () =>
      isDefaultMentionTrigger
        ? attachmentMentionGroup(attachments, activeMentionQuery)
        : null,
    [activeMentionQuery, attachments, isDefaultMentionTrigger],
  );
  const composerMentionGroups = useMemo(
    () =>
      attachmentGroup === null
        ? mentionGroups
        : [attachmentGroup, ...mentionGroups],
    [attachmentGroup, mentionGroups],
  );
  const activeSuggestions = useMemo<readonly TypeaheadSuggestion[]>(
    () =>
      activeTriggerKind === "command"
        ? orderedCommandSuggestions
        : activeTriggerKind === "mention"
          ? composerMentionGroups.flatMap((group) => group.suggestions)
          : [],
    [activeTriggerKind, composerMentionGroups, orderedCommandSuggestions],
  );
  const selectedSuggestionIndex = useMemo(() => {
    if (selectedSuggestionKey === null) return -1;
    return activeSuggestions.findIndex(
      (suggestion) =>
        typeaheadSuggestionKey(suggestion) === selectedSuggestionKey,
    );
  }, [activeSuggestions, selectedSuggestionKey]);
  const selectedIndex = Math.max(0, selectedSuggestionIndex);

  const mentionMenuState: MentionMenuState =
    attachmentGroup !== null
      ? {
          kind: "results",
          groups: composerMentionGroups,
          refreshing: mentionRefreshing,
        }
      : activeMentionQuery.length === 0
        ? { kind: "hint" }
        : mentionLoading
          ? { kind: "loading" }
          : mentionError
            ? { kind: "error" }
            : {
                kind: "results",
                groups: mentionGroups,
                refreshing: mentionRefreshing,
              };

  const commandMenuState: CommandMenuState = commandLoading
    ? { kind: "loading" }
    : commandError
      ? { kind: "error" }
      : {
          kind: "results",
          groups: commandGroups,
          refreshing: commandRefreshing,
        };

  const isCommandTriggerLiteral =
    activeTriggerKind === "command" &&
    !commandLoading &&
    !commandError &&
    orderedCommandSuggestions.length === 0;
  const isBareNonDefaultMentionTrigger =
    activeTrigger?.kind === "mention" &&
    activeTrigger.char !== DEFAULT_MENTION_TRIGGER &&
    activeMentionQuery.length === 0;
  const showTypeaheadMenu =
    !showVoiceActionGroup &&
    activeTrigger !== null &&
    !isCommandTriggerLiteral &&
    !isBareNonDefaultMentionTrigger;

  useTypeaheadMenuMaxHeight(
    typeaheadMenuRef,
    showTypeaheadMenu && mentionMenuPlacement === "top",
  );

  const contributions = useComposerContributions();
  const popups = contributions.popups;
  const popupContribution =
    composerMenu?.kind === "plugin"
      ? (popups.find((popup) => popup.key === composerMenu.key) ?? null)
      : null;
  const popupOpen =
    composerMenu?.kind === "plugin" &&
    composerMenu.open &&
    popupContribution !== null;
  const composerMenuOpen = popupOpen || showTypeaheadMenu;
  const typeaheadMenuState: TypeaheadMenuState =
    activeTrigger?.kind === "command"
      ? {
          trigger: "command",
          char: activeTrigger.char,
          state: commandMenuState,
        }
      : { trigger: "mention", state: mentionMenuState };

  useEffect(() => {
    if (selectedSuggestionKey !== null && selectedSuggestionIndex === -1) {
      setSelectedSuggestionKey(null);
    }
  }, [selectedSuggestionIndex, selectedSuggestionKey]);

  const finishApply = useCallback(
    (appliedEditor: Editor) => {
      const nextValue = promptEditorValueFromDoc(appliedEditor.state.doc);
      lastSyncedEditorValueRef.current = nextValue;
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

  const insertPromptMentionPill = useCallback(
    ({
      editor: targetEditor,
      range,
      pills,
      trailingText,
      dismissedTrigger,
    }: {
      editor: Editor;
      range: { from: number; to: number };
      pills: readonly { mention: MentionTarget; serializedText: string }[];
      trailingText: string;
      dismissedTrigger: DismissedTriggerRange | null;
    }) => {
      triggerKeyRef.current = "";
      dismissedTriggerRef.current = dismissedTrigger;
      isRestoringAppliedMentionRef.current = true;
      setComposerMenu(null);
      setSelectedSuggestionKey(null);

      try {
        skipEditorChangeRef.current = true;
        targetEditor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            ...pills.flatMap(({ mention, serializedText }, index) => [
              ...(index > 0 ? [{ type: "text", text: " " }] : []),
              {
                type: "mention",
                attrs: {
                  mention,
                  serializedText,
                } satisfies PromptEditorMentionAttrs,
              },
            ]),
            ...(trailingText ? [{ type: "text", text: trailingText }] : []),
          ])
          .run();
      } finally {
        skipEditorChangeRef.current = false;
      }
      finishApply(targetEditor);
    },
    [finishApply, setComposerMenu],
  );

  const insertDroppedThreads = useCallback(
    (
      threads: readonly ExperimentalDroppedThreadMention[],
      x: number,
      y: number,
    ) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed || threads.length === 0)
        return;
      const position =
        currentEditor.view.posAtCoords({ left: x, top: y })?.pos ??
        currentEditor.state.selection.to;
      insertPromptMentionPill({
        editor: currentEditor,
        range: { from: position, to: position },
        pills: threads.map((thread) => ({
          mention: {
            kind: "thread",
            threadId: thread.threadId,
            label: thread.label,
          },
          serializedText: `@thread:${thread.threadId}`,
        })),
        trailingText: mentionPillTrailingText(
          currentEditor.state.doc,
          position,
        ),
        dismissedTrigger: null,
      });
    },
    [insertPromptMentionPill],
  );

  const applyMentionSuggestion = useCallback(
    (item: MenuMentionSuggestion) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || activeTrigger?.kind !== "mention") return;

      const replacement = item.text.trim();
      insertPromptMentionPill({
        editor: currentEditor,
        range: { from: activeTrigger.from, to: activeTrigger.to },
        pills: [
          {
            mention: item.mention,
            serializedText: replacement.startsWith(activeTrigger.char)
              ? replacement
              : `${activeTrigger.char}${replacement}`,
          },
        ],
        trailingText: mentionPillTrailingText(
          currentEditor.state.doc,
          activeTrigger.to,
        ),
        dismissedTrigger: {
          start: activeTrigger.from,
          end: activeTrigger.from + 2,
          hasLeftRange: false,
        },
      });
    },
    [activeTrigger, insertPromptMentionPill],
  );

  const applyCommandSuggestion = useCallback(
    (item: ExperimentalComposerCommandSuggestion) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || activeTrigger === null) return;
      if (activeTrigger.kind !== "command") return;

      const trailingText = mentionPillTrailingText(
        currentEditor.state.doc,
        activeTrigger.to,
      );
      insertPromptMentionPill({
        editor: currentEditor,
        range: { from: activeTrigger.from, to: activeTrigger.to },
        pills: [
          {
            mention: commandMentionTarget(item, activeTrigger.char),
            serializedText: `${activeTrigger.char}${item.name}`,
          },
        ],
        trailingText,
        dismissedTrigger: {
          start: activeTrigger.from,
          end: commandPillDismissedRangeEnd({
            triggerPosition: activeTrigger.from,
            trailingText,
          }),
          hasLeftRange: false,
        },
      });
    },
    [activeTrigger, insertPromptMentionPill],
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

  const handleComposerMenuKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!composerMenuOpen || event.defaultPrevented) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissComposerMenu(true);
        return true;
      }
      if (
        popupOpen &&
        event.key === "Enter" &&
        event.target instanceof HTMLInputElement
      ) {
        event.preventDefault();
        return true;
      }
      return false;
    },
    [composerMenuOpen, dismissComposerMenu, popupOpen],
  );

  const openPopupForPlugin = useCallback(
    (pluginId: string, popupId: string) => {
      const contribution = popups.find(
        (popup) => popup.pluginId === pluginId && popup.popup.id === popupId,
      );
      if (!contribution) return false;
      dismissComposerMenu();
      setComposerMenu({ kind: "plugin", key: contribution.key, open: true });
      return true;
    },
    [dismissComposerMenu, popups, setComposerMenu],
  );

  const closePopupForPlugin = useCallback(
    (pluginId: string) => {
      const current = composerMenuRef.current;
      if (
        current?.kind !== "plugin" ||
        !current.open ||
        !popups.some(
          (popup) => popup.key === current.key && popup.pluginId === pluginId,
        )
      )
        return false;
      dismissComposerMenu(true);
      return true;
    },
    [dismissComposerMenu, popups],
  );

  const focusEnd = useCallback(() => {
    if (isPointerCoarse) {
      pendingFocusEndRef.current = false;
      return;
    }
    const currentEditor = editorRef.current;
    if (!currentEditor || currentEditor.isDestroyed) {
      pendingFocusEndRef.current = true;
      return;
    }
    pendingFocusEndRef.current = false;
    focusEditorAtEnd(currentEditor);
    scheduleRevealEditorSelection();
  }, [isPointerCoarse, scheduleRevealEditorSelection]);

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

      const insertion = currentEditor.chain();
      if (!isPointerCoarse) insertion.focus();
      insertion.insertContent(insertedText).run();
      if (!isPointerCoarse) scheduleRevealEditorSelection();
    },
    [isPointerCoarse, scheduleRevealEditorSelection],
  );

  const focusAfterPromptAction = useCallback(
    (currentEditor: Editor, position?: "end") => {
      const focusEditor = () => {
        promptActionFocusFrameRef.current = null;
        if (currentEditor.isDestroyed) return;
        currentEditor.commands.focus(position);
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
      const currentEditor = editorRef.current;
      const commandAction = promptActionCommandFromAction(action);

      if (commandAction) {
        const next = withLeadingCommand(
          { text: valueRef.current, mentions: mentionRangesRef.current },
          commandAction,
        );
        onChangeRef.current(next.text, next.mentions);
        if (currentEditor && !currentEditor.isDestroyed) {
          focusAfterPromptAction(currentEditor, "end");
        }
        return;
      }

      if (!currentEditor || currentEditor.isDestroyed) {
        const currentValue = valueRef.current;
        if (currentValue.endsWith(action.text)) return;
        onChangeRef.current(`${currentValue}${action.text}`, [
          ...mentionRangesRef.current,
        ]);
        return;
      }

      const insertionRange = skillsTriggerInsertionRange(
        currentEditor,
        action,
        triggers,
      );
      if (insertionRange === null) {
        focusAfterPromptAction(currentEditor);
        return;
      }

      triggerKeyRef.current = "";
      dismissedTriggerRef.current = null;
      setSelectedSuggestionKey(null);
      currentEditor
        .chain()
        .focus()
        .deleteRange({ from: insertionRange.from, to: insertionRange.to })
        .insertContent(action.text)
        .run();
      finishApply(currentEditor);
    },
    [finishApply, focusAfterPromptAction, triggers],
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

  const voiceSubmitBaselineRef = useRef<string | null>(null);
  const sendVoiceTranscript = useCallback(
    (text: string) => {
      voiceSubmitBaselineRef.current = valueRef.current;
      insertTextAtCursor(text);
    },
    [insertTextAtCursor],
  );

  const composerVoice = useMemo(
    () => ({
      textBeforeCursor: () => getTextBeforeCursor() ?? null,
      deliverTranscript: (text: string, delivery: "insert" | "send") => {
        if (delivery === "send") sendVoiceTranscript(text);
        else insertTextAtCursor(text);
      },
      playCompletionTransition: playVoiceCompletionTransition,
    }),
    [
      getTextBeforeCursor,
      insertTextAtCursor,
      sendVoiceTranscript,
      playVoiceCompletionTransition,
    ],
  );

  const canSubmitActionAfterVoice = (
    action: ExperimentalComposerAction | null,
  ) =>
    action !== null &&
    (!action.requiresInput || hasSubmittableInput) &&
    !isAttaching &&
    !isSubmitting &&
    !submitDisabled;
  const canSubmitAction = (action: ExperimentalComposerAction | null) =>
    canSubmitActionAfterVoice(action) && !showVoiceActionGroup;
  const canSubmitVoiceTranscript =
    hasSubmittableInput && canSubmitActionAfterVoice(primarySubmitAction);
  const canPrimarySubmit = canSubmitAction(primarySubmitAction);
  const canSubmit = hasSubmittableInput && canPrimarySubmit;
  const canModifierSubmit = canSubmitAction(modifierSubmitAction);
  const submittingBlockedReason = composerSubmittingBlockedReason({
    canSubmit: canPrimarySubmit,
    hasSubmittableInput,
    isAttaching,
    isSubmitting,
    voiceActive: showVoiceActionGroup,
    submitDisabledReason,
  });
  const composerEditorState = useMemo<ExperimentalComposerEditorState>(
    () => ({
      layout: composerLayout,
      isRunning,
      isSubmitting,
      isSubmittingBlocked: !canPrimarySubmit,
      submittingBlockedReason,
      isAttaching,
      attachmentError,
    }),
    [
      attachmentError,
      canPrimarySubmit,
      composerLayout,
      isAttaching,
      isRunning,
      isSubmitting,
      submittingBlockedReason,
    ],
  );
  const insertAtCursorForPlugin = useCallback(
    (draft: ComposerDraft, block: boolean) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || currentEditor.isDestroyed) return false;
      const value = { text: draft.text, mentions: [...draft.mentions] };
      const insertion = currentEditor.chain();
      if (!isPointerCoarse) insertion.focus();
      insertion
        .insertContent(
          block
            ? promptEditorContentFromValue(value)
            : promptEditorInlineContentFromValue(value),
        )
        .run();
      if (!isPointerCoarse) scheduleRevealEditorSelection();
      return true;
    },
    [isPointerCoarse, scheduleRevealEditorSelection],
  );
  const composerEditor = useMemo<ExperimentalComposerEditor>(
    () => ({
      state: composerEditorState,
      insertAtCursor: insertAtCursorForPlugin,
      focus: () => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) return false;
        if (!currentEditor.isEditable) return false;
        currentEditor.view.focus();
        return true;
      },
      acceptsThreadDrop: () => {
        const currentEditor = editorRef.current;
        return (
          currentEditor !== null &&
          !currentEditor.isDestroyed &&
          currentEditor.isEditable
        );
      },
      insertDroppedThreads,
      focusEnd,
      voice: composerVoice,
      openPopup: openPopupForPlugin,
      closePopup: closePopupForPlugin,
      isPopupOpen: () => {
        const current = composerMenuRef.current;
        return (
          current?.kind === "plugin" &&
          current.open &&
          popups.some((popup) => popup.key === current.key)
        );
      },
    }),
    [
      composerEditorState,
      insertAtCursorForPlugin,
      insertDroppedThreads,
      focusEnd,
      composerVoice,
      openPopupForPlugin,
      closePopupForPlugin,
      popups,
    ],
  );
  const showStop = Boolean(
    isRunning && onStop && !canSubmit && !isAttaching && !showVoiceActionGroup,
  );
  const canStartVoiceInput =
    voice !== undefined && voice.isSupported && !isSubmitting;
  const showVoiceAsPrimaryAction =
    isPointerCoarse &&
    !isAttaching &&
    !hasSubmittableInput &&
    canStartVoiceInput;
  const showCompactVoiceAction =
    showCompactLayout &&
    canStartVoiceInput &&
    (!showVoiceAsPrimaryAction || showStop);
  const handleVoicePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isPointerCoarse || event.button !== 0) return;

      event.preventDefault();
    },
    [isPointerCoarse],
  );
  const startVoiceInput = useCallback(() => {
    if (isPointerCoarse) {
      const currentEditor = editorRef.current;
      if (currentEditor && !currentEditor.isDestroyed) {
        blurActiveKeyboardInputWithin(currentEditor.view.dom);
      }
    }
    void voice?.start();
  }, [isPointerCoarse, voice]);
  const cancelVoiceInput = useCallback(() => {
    if (voiceActionRevealFrameRef.current !== null) {
      window.cancelAnimationFrame(voiceActionRevealFrameRef.current);
      voiceActionRevealFrameRef.current = null;
    }
    setVoiceActionTransition("exiting");
    voice?.cancel();
  }, [voice]);
  const attachmentUploadTitle = "Uploading attachments...";
  const effectiveSubmitTitle = isAttaching
    ? attachmentUploadTitle
    : !canSubmit && submitDisabledReason
      ? submitDisabledReason
      : submitTitle;

  const dispatchSubmit = useCallback(() => {
    if (editorRef.current) cancelPromptThreadLinkPaste(editorRef.current);
    onSubmit?.();
  }, [onSubmit]);

  const submitPrompt = useCallback(() => {
    const shouldBlurAfterSubmit = blurAfterPointerSubmitRef.current;
    blurAfterPointerSubmitRef.current = false;
    if (!canPrimarySubmit) return;
    dispatchSubmit();
    if (shouldBlurAfterSubmit) {
      blurPromptEditor(editorRef.current);
    }
  }, [canPrimarySubmit, dispatchSubmit]);

  useLayoutEffect(() => {
    const baseline = voiceSubmitBaselineRef.current;
    if (baseline === null || value === baseline) return;
    voiceSubmitBaselineRef.current = null;
    if (canSubmitVoiceTranscript) dispatchSubmit();
  }, [value, canSubmitVoiceTranscript, dispatchSubmit]);

  const handleSubmitClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      blurAfterPointerSubmitRef.current =
        blurOnPointerSubmit && event.detail > 0;
    },
    [blurOnPointerSubmit],
  );

  const handleTouchSubmit = useCallback(() => {
    blurAfterPointerSubmitRef.current = blurOnPointerSubmit;
    submitPrompt();
  }, [blurOnPointerSubmit, submitPrompt]);

  const handleSubmitPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (isPointerCoarse) {
        event.preventDefault();
        return;
      }
      const currentEditor = editorRef.current;
      const editorElement = currentEditor?.view.dom;
      const activeElement = editorElement?.ownerDocument.activeElement;
      if (
        !currentEditor ||
        currentEditor.isDestroyed ||
        !editorElement?.contains(activeElement ?? null)
      ) {
        return;
      }

      event.preventDefault();
    },
    [isPointerCoarse],
  );

  const [pendingCommandSubmit, setPendingCommandSubmit] = useState(false);
  useEffect(() => {
    if (!pendingCommandSubmit) return;
    setPendingCommandSubmit(false);
    submitPrompt();
  }, [pendingCommandSubmit, submitPrompt]);

  const submitModifierPrompt = useCallback(() => {
    if (!canModifierSubmit || !onModifierSubmit) return;
    if (editorRef.current) cancelPromptThreadLinkPaste(editorRef.current);
    onModifierSubmit();
  }, [canModifierSubmit, onModifierSubmit]);

  const applyHistoryDraft = useCallback(
    (draft: ComposerDraftSnapshot) => {
      if (!history) {
        return;
      }

      history.onSelectEntry(draft);
      requestAnimationFrame(() => {
        const currentEditor = editorRef.current;
        if (!currentEditor || currentEditor.isDestroyed) {
          return;
        }

        focusEditorAtEnd(currentEditor);
        syncTriggerState(currentEditor);
        scheduleRevealEditorSelection();
      });
    },
    [history, scheduleRevealEditorSelection, syncTriggerState],
  );

  const collapsePromptBox = useCallback(() => {
    if (!onCollapse) return;
    blurPromptEditor(editorRef.current);
    onCollapse();
  }, [onCollapse]);

  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;
      attachFilesWithHistory(Array.from(fileList));
      event.target.value = "";
    },
    [attachFilesWithHistory],
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
      focusEditorAtEnd(currentEditor);
      scheduleRevealEditorSelection();
    },
    [scheduleRevealEditorSelection],
  );

  const handleEditorKeyDown = useCallback(
    (event: KeyboardEvent, isOriginalIPadHardwareEnter = false): boolean => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        postCompositionKeyDownEvents.has(event)
      ) {
        return false;
      }
      if (dispatchAppCommandKey(event) || handleComposerMenuKeyDown(event)) {
        return true;
      }
      const canSubmitWithEnterKey =
        !isPointerCoarse || isOriginalIPadHardwareEnter;
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
        areDraftsEqual(history.currentDraft, activeHistoryEntry),
      );
      const canNavigateHistory =
        history !== undefined &&
        !hasArrowNavigationModifier &&
        hasCursorAtEnd &&
        (isDraftEmpty(history.currentDraft) || hasSelectedHistoryEntry);
      const canNavigateTypeahead =
        showTypeaheadMenu && !hasArrowNavigationModifier && !canNavigateHistory;

      if (showTypeaheadMenu) {
        if (
          event.key === "ArrowDown" &&
          canNavigateTypeahead &&
          activeSuggestions.length > 0
        ) {
          event.preventDefault();
          const nextIndex = (selectedIndex + 1) % activeSuggestions.length;
          const nextSuggestion = activeSuggestions[nextIndex];
          if (nextSuggestion) {
            setSelectedSuggestionKey(typeaheadSuggestionKey(nextSuggestion));
          }
          return true;
        }
        if (
          event.key === "ArrowUp" &&
          canNavigateTypeahead &&
          activeSuggestions.length > 0
        ) {
          event.preventDefault();
          const nextIndex =
            (selectedIndex + activeSuggestions.length - 1) %
            activeSuggestions.length;
          const nextSuggestion = activeSuggestions[nextIndex];
          if (nextSuggestion) {
            setSelectedSuggestionKey(typeaheadSuggestionKey(nextSuggestion));
          }
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
            if (
              event.key === "Enter" &&
              selected.kind === "command" &&
              selected.origin === "builtin"
            ) {
              setPendingCommandSubmit(true);
            }
          }
          return true;
        }
      }

      if (event.key === "Escape") {
        if (onEscape) {
          onEscape();
          return true;
        }
        blurPromptEditor(currentEditor);
        return true;
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
          hasActiveHistorySessionRef.current = true;
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

      if (isModifierSubmitKeyEvent(event) && onModifierSubmit) {
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
        (event.shiftKey || !canSubmitWithEnterKey);
      if (
        isPromptNewlineKey &&
        currentEditor &&
        applyPromptParagraphNewline(currentEditor)
      ) {
        event.preventDefault();
        return true;
      }

      if (!canSubmitWithEnterKey) return false;
      const isSubmitKey = event.key === "Enter" && !event.shiftKey;

      if (!isSubmitKey) return false;
      event.preventDefault();
      submitPrompt();
      return true;
    },
    [
      activeHistoryIndex,
      activeSuggestions,
      applyHistoryDraft,
      applyTrigger,
      dispatchAppCommandKey,
      handleComposerMenuKeyDown,
      history,
      isPointerCoarse,
      onEscape,
      onModifierSubmit,
      postCompositionKeyDownEvents,
      resetHistorySession,
      selectedIndex,
      setPendingCommandSubmit,
      showTypeaheadMenu,
      submitModifierPrompt,
      submitPrompt,
      temporaryHistoryDraft,
    ],
  );

  useLayoutEffect(() => {
    handleEditorKeyDownRef.current = handleEditorKeyDown;
  }, [handleEditorKeyDown]);

  useEffect(() => {
    if (!showVoiceActionGroup || !voice) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelVoiceInput();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [cancelVoiceInput, showVoiceActionGroup, voice]);

  return (
    <form
      ref={formRef}
      data-promptbox=""
      data-promptbox-compact={showCompactLayout ? "" : undefined}
      data-promptbox-collapsed={compact === undefined ? undefined : ""}
      data-promptbox-voice-active={showVoiceActionGroup ? "" : undefined}
      onSubmit={handleSubmit}
      onKeyDown={(event) => handleComposerMenuKeyDown(event.nativeEvent)}
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
        attachFilesWithHistory(Array.from(event.dataTransfer.files));
      }}
      className={cn(
        "group/promptbox relative w-full rounded-xl border border-border bg-background shadow-lift",
        showCompactLayout && "overflow-hidden",
      )}
    >
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      {handoff ? (
        <div
          inert={showVoiceActionGroup ? true : undefined}
          className="px-3 pt-1.5"
        >
          {handoff}
        </div>
      ) : null}
      {voice && voice.failedRecordings.length > 0 ? (
        <FailedVoiceRecordings
          recordings={voice.failedRecordings}
          className="px-1.5 pt-1.5"
          retryDisabled={false}
          onRetry={voice.retry}
          onDownload={voice.download}
          onDiscard={voice.discard}
        />
      ) : null}
      <div
        data-promptbox-layout=""
        className={cn(COLLAPSING_GRID_CLASS, showCompactLayout && "relative")}
        style={{ gridTemplateRows: "1fr" }}
      >
        <div
          data-promptbox-main=""
          className={cn(
            "min-h-0 overflow-hidden transition-opacity duration-[180ms] motion-reduce:transition-none",
            showCompactLayout && "relative flex h-12 items-center",
            showVoiceActionGroup && "pointer-events-none",
          )}
        >
          {showCompactLayout ? (
            <AttachmentPreview
              compact
              attachments={attachments}
              pendingUploads={pendingUploads}
              attachmentProjectId={attachmentProjectId}
              expandedImageIndex={expandedImageIndex}
              onExpandedImageIndexChange={setExpandedImageIndex}
              onRemoveAttachment={
                onUpdateAttachments ? removeAttachment : undefined
              }
            />
          ) : null}
          <div
            data-promptbox-input-region=""
            aria-hidden={
              showCompactLayout && showVoiceActionGroup ? true : undefined
            }
            className={cn(
              "relative",
              showCompactLayout && "min-w-0 flex-1",
              showCompactLayout && showVoiceActionGroup && "invisible",
            )}
          >
            {!showCompactLayout ? (
              <>
                <div data-promptbox-expanded-only="">
                  <AppCommandShortcutHint
                    shortcut={focusComposerShortcut}
                    className={cn(
                      "absolute top-2 z-20 group-focus-within/promptbox:hidden",
                      onCollapse ? "right-10" : "right-2",
                    )}
                  />
                </div>
                {onCollapse ? (
                  <div
                    data-promptbox-expanded-only=""
                    data-promptbox-standard-actions=""
                    inert={showVoiceActionGroup ? true : undefined}
                    className="absolute right-[13px] top-2 z-20 flex items-center"
                  >
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={collapsePromptBox}
                      aria-label="Collapse prompt box"
                      className={cn(
                        CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
                        COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
                        PROMPT_STACK_EDGE_CARET_BUTTON_WIDTH_CLASS,
                      )}
                    >
                      <Icon name="ChevronDown" className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            <ComposerEditorSlot
              editor={editor}
              scrollContainerRef={editorScrollContainerRef}
              inputLocked={composerInputLocked}
              isCompactLayout={showCompactLayout}
              minHeight={minHeight}
              layout={surface === "new-thread" ? "root-compose" : "thread"}
              resolveMentionLink={mentionResolveLink}
            />
          </div>

          <>
            <ComposerRoot
              rootRef={formRef}
              editor={composerEditor}
              menuRef={typeaheadMenuRef}
              menuOpen={composerMenuOpen}
            />
            <ComposerPopupHost
              open={composerMenuOpen}
              placement={mentionMenuPlacement}
              label={popupContribution?.popup.label ?? "Suggestions"}
              interactive={popupContribution !== null}
              popupKey={popupContribution?.key ?? null}
              popupRef={typeaheadMenuRef}
              composerRef={formRef}
              onClose={dismissComposerMenu}
            >
              {popupContribution !== null ? (
                <contributions.Popup
                  key={popupContribution.key}
                  contribution={popupContribution}
                  onClose={() => dismissComposerMenu(true)}
                />
              ) : (
                <MentionMenu
                  state={typeaheadMenuState}
                  selectedIndex={selectedIndex}
                  onApply={applyTrigger}
                  onDismiss={isPointerCoarse ? dismissComposerMenu : undefined}
                />
              )}
            </ComposerPopupHost>
          </>

          {!showCompactLayout ? (
            <>
              <div
                data-promptbox-expanded-only=""
                inert={showVoiceActionGroup ? true : undefined}
              >
                <AttachmentPreview
                  attachments={attachments}
                  pendingUploads={pendingUploads}
                  attachmentProjectId={attachmentProjectId}
                  expandedImageIndex={expandedImageIndex}
                  onExpandedImageIndexChange={setExpandedImageIndex}
                  onRemoveAttachment={
                    onUpdateAttachments ? removeAttachment : undefined
                  }
                />

                {attachmentError ? (
                  <div className="mx-3 mb-1 mt-1 text-xs text-destructive">
                    {attachmentError}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <>
            <div
              data-promptbox-action-row=""
              className={cn(
                "relative flex shrink-0 select-none flex-row flex-wrap items-center gap-3 pb-2 pl-3.5 pr-[13px] pt-1.5",
                showCompactLayout && "flex-nowrap gap-0 p-0 pr-2",
                showCompactLayout && showVoiceActionGroup && "absolute inset-0",
              )}
            >
              {voice && isVoiceActionPresent ? (
                <div
                  data-promptbox-voice-controls=""
                  data-voice-transition={voiceActionTransition}
                  inert={isVoiceActionVisible ? undefined : true}
                  aria-hidden={isVoiceActionVisible ? undefined : true}
                  className={cn(
                    "absolute inset-0 z-10 min-w-0 origin-center transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] motion-reduce:transition-none",
                    isVoiceActionVisible
                      ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                      : "pointer-events-none translate-y-1 scale-[0.985] opacity-0",
                  )}
                >
                  <VoiceRecordingBar
                    isCompact={showCompactLayout}
                    state={renderedVoiceActionState}
                    delivery={voice.delivery}
                    stream={voice.stream}
                    microphoneWarning={voice.microphoneWarning}
                    submitIcon={submitIcon ?? "CornerDownLeft"}
                    onConfirm={voice.stop}
                    onSend={voice.send}
                    onCancel={cancelVoiceInput}
                  />
                </div>
              ) : null}
              {!showCompactLayout ? (
                <div
                  data-promptbox-expanded-only=""
                  data-promptbox-standard-actions=""
                  className={cn(
                    "flex min-w-9 flex-1 flex-row items-center gap-1 transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                    showVoiceActionGroup
                      ? "pointer-events-none translate-y-1 opacity-0"
                      : "translate-y-0 opacity-100",
                  )}
                  inert={showVoiceActionGroup ? true : undefined}
                  aria-live="polite"
                >
                  <ComposerPlusMenuSlot
                    actions={promptActions}
                    onAttach={
                      onAttachFiles
                        ? () => attachmentInputRef.current?.click()
                        : undefined
                    }
                    onAction={applyPromptAction}
                  />
                  {executionControls}
                </div>
              ) : null}
              <div
                data-promptbox-standard-actions=""
                className={cn(
                  "flex min-w-0 max-w-full shrink-0 flex-row flex-wrap items-center justify-end gap-1 transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                  showVoiceActionGroup
                    ? "pointer-events-none translate-y-1 opacity-0"
                    : "translate-y-0 opacity-100",
                )}
                inert={showVoiceActionGroup ? true : undefined}
              >
                <>
                  {!showCompactLayout ? <contributions.Actions /> : null}
                  {compactBeforeSend}
                  {!showCompactLayout || showCompactVoiceAction ? (
                    <>
                      {voice &&
                      !showVoiceActionGroup &&
                      (!showVoiceAsPrimaryAction || showStop) ? (
                        <VoiceInputButton
                          warning={voice?.microphoneWarning ?? null}
                          data-promptbox-expanded-only={
                            showCompactLayout ? undefined : ""
                          }
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={
                            !voice.isSupported
                              ? voice.unsupportedMessage
                              : "Start voice input"
                          }
                          disabled={!canStartVoiceInput}
                          onPointerDown={handleVoicePointerDown}
                          onClick={startVoiceInput}
                          className={
                            showCompactLayout
                              ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                              : COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS
                          }
                        >
                          <Icon name="Mic" className="size-4" />
                        </VoiceInputButton>
                      ) : null}
                    </>
                  ) : null}
                  <div
                    data-promptbox-submit-group=""
                    className="flex shrink-0 flex-row items-center"
                  >
                    {showStop ? (
                      <Button
                        data-promptbox-submit-action=""
                        type="button"
                        size="icon"
                        variant="secondary"
                        aria-label="Stop run"
                        onClick={onStop}
                        className={
                          showCompactLayout
                            ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                            : COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS
                        }
                      >
                        <Icon
                          name="Square"
                          className="size-3.5 fill-current [&_*]:stroke-0"
                        />
                      </Button>
                    ) : showVoiceAsPrimaryAction ? (
                      <VoiceInputButton
                        warning={voice?.microphoneWarning ?? null}
                        data-promptbox-submit-action=""
                        type="button"
                        size={showCompactLayout ? "icon" : "sm"}
                        variant="default"
                        aria-label="Start voice input"
                        onPointerDown={handleVoicePointerDown}
                        onClick={startVoiceInput}
                        className={cn(
                          showCompactLayout
                            ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                            : [
                                "ml-1",
                                COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                              ],
                          "transition-colors",
                        )}
                      >
                        <Icon name="Mic" className="size-4" />
                      </VoiceInputButton>
                    ) : (
                      <ComposerSendMenu
                        isPointerCoarse={isPointerCoarse}
                        modifierKind={modifierSubmitAction?.kind ?? null}
                        hasInput={hasSubmittableInput}
                        canSubmit={canSubmit}
                        onSubmit={
                          showModifierInMenu && onModifierSubmit
                            ? submitModifierPrompt
                            : undefined
                        }
                      >
                        <PromptSubmitButton
                          canSubmit={canSubmit}
                          icon={submitIcon}
                          label={submitLabel}
                          className={cn(
                            showCompactLayout
                              ? COMPACT_PROMPT_ACTION_BUTTON_CLASS
                              : [
                                  "ml-1",
                                  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
                                ],
                            "transition-colors",
                          )}
                          disabledReason={
                            !canSubmit
                              ? isAttaching
                                ? attachmentUploadTitle
                                : submitDisabledReason
                              : undefined
                          }
                          isBusy={isSubmitting || isAttaching}
                          isCompact={showCompactLayout}
                          onPointerDown={handleSubmitPointerDown}
                          onClick={handleSubmitClick}
                          onTouchSubmit={handleTouchSubmit}
                          title={effectiveSubmitTitle}
                        />
                      </ComposerSendMenu>
                    )}
                  </div>
                </>
              </div>
            </div>
          </>
        </div>
      </div>
    </form>
  );
}
