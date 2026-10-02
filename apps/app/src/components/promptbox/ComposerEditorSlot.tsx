import { useEffect, type DependencyList, type RefObject } from "react";
import { COARSE_POINTER_TEXT_BASE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PromptMentionLinkContext,
  type PromptMentionLinkResolver,
} from "./editor/prompt-mention-link";
import type {
  Editor,
  PromptEditorEngine,
  UseEditorOptions,
} from "./editor/prompt-editor-engine";

export type ComposerEditorLayout = "thread" | "root-compose";

const COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT: Record<
  ComposerEditorLayout,
  string
> = {
  thread: "calc(50dvh - 3rem)",
  "root-compose": "calc(70dvh - 3rem)",
};

export function blurPromptEditor(editor: Editor | null | undefined): void {
  editor?.view.dom.blur();
  window.getSelection()?.removeAllRanges();
}

export function PromptEditorHost({
  engine,
  options,
  deps,
  onEditorChange,
}: {
  engine: PromptEditorEngine;
  options: UseEditorOptions;
  deps: DependencyList;
  onEditorChange: (editor: Editor | null) => void;
}) {
  const editor = engine.useEditor(options, deps);

  useEffect(() => {
    onEditorChange(editor);
    return () => {
      onEditorChange(null);
    };
  }, [editor, onEditorChange]);

  return null;
}

export function ComposerEditorSlot({
  editor,
  engine,
  editorOptions,
  editorDeps,
  onEditorChange,
  fallbackTextareaRef,
  onFallbackFocusChange,
  onFallbackKeyDown,
  onFallbackChange,
  value,
  placeholder,
  enterKeyHint,
  id,
  scrollContainerRef,
  inputLocked,
  isCompactLayout,
  minHeight,
  layout,
  resolveMentionLink,
}: {
  editor: Editor | null;
  engine: PromptEditorEngine | null;
  editorOptions: UseEditorOptions | null;
  editorDeps: DependencyList;
  onEditorChange: (editor: Editor | null) => void;
  fallbackTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onFallbackFocusChange: (focused: boolean) => void;
  onFallbackKeyDown: (event: KeyboardEvent) => void;
  onFallbackChange: (value: string) => void;
  value: string;
  placeholder: string;
  enterKeyHint: "enter" | "send";
  id: string | undefined;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  inputLocked: boolean;
  isCompactLayout: boolean;
  minHeight: number;
  layout: ComposerEditorLayout;
  resolveMentionLink: PromptMentionLinkResolver | undefined;
}) {
  const EngineEditorContent = engine?.EditorContent ?? null;

  return (
    <div
      ref={scrollContainerRef}
      data-promptbox-editor-scroll=""
      aria-busy={inputLocked || undefined}
      className={cn(
        "w-full overflow-y-auto bg-transparent px-4 pb-1 pr-14 pt-3 outline-none",
        COARSE_POINTER_TEXT_BASE_CLASS,
        "leading-relaxed",
        isCompactLayout && "h-12 overflow-hidden pb-0 pr-14 pt-0",
      )}
      style={{
        minHeight: isCompactLayout ? "48px" : `${minHeight}px`,
        height: isCompactLayout ? "48px" : undefined,
        maxHeight: isCompactLayout
          ? "48px"
          : COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT[layout],
      }}
    >
      <PromptMentionLinkContext.Provider value={resolveMentionLink ?? null}>
        {engine !== null && editorOptions !== null ? (
          <PromptEditorHost
            engine={engine}
            options={editorOptions}
            deps={editorDeps}
            onEditorChange={onEditorChange}
          />
        ) : null}
        {engine === null ? (
          <div
            data-promptbox-fallback-editor=""
            className={cn(
              "h-full min-h-full",
              isCompactLayout && "flex items-center overflow-hidden",
            )}
          >
            <textarea
              ref={fallbackTextareaRef}
              id={id}
              value={value}
              aria-label={placeholder}
              placeholder={placeholder}
              enterKeyHint={enterKeyHint}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              rows={1}
              readOnly={inputLocked}
              aria-readonly={inputLocked ? "true" : undefined}
              data-promptbox-fallback-textarea=""
              onChange={(event) => {
                onFallbackChange(event.target.value);
              }}
              onFocus={() => {
                onFallbackFocusChange(true);
              }}
              onBlur={() => {
                onFallbackFocusChange(false);
              }}
              onKeyDown={(event) => {
                onFallbackKeyDown(event.nativeEvent);
              }}
              className={cn(
                "h-full min-h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent leading-[1.7] outline-none",
                "placeholder:select-none placeholder:text-subtle-foreground placeholder:font-light placeholder:opacity-70",
                isCompactLayout && "flex-1",
              )}
            />
          </div>
        ) : EngineEditorContent !== null ? (
          <EngineEditorContent
            editor={editor}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              if (editor === null || editor.isEditable) return;
              event.preventDefault();
              blurPromptEditor(editor);
            }}
            data-promptbox-editor-content=""
            data-promptbox-compact-content={isCompactLayout ? "" : undefined}
            className={cn(
              "h-full min-h-full",
              isCompactLayout && "flex items-center",
              "[&_.ProseMirror]:min-h-full [&_.ProseMirror]:leading-[1.7] [&_.ProseMirror]:outline-none",
              "[&_.ProseMirror_p]:m-0",
              "[&_.ProseMirror_blockquote]:my-1 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-surface-selected-border [&_.ProseMirror_blockquote]:pl-3 [&_.ProseMirror_blockquote]:text-muted-foreground",
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
            )}
          />
        ) : null}
      </PromptMentionLinkContext.Provider>
    </div>
  );
}
