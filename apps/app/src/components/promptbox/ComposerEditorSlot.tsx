import type { RefObject } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { COARSE_POINTER_TEXT_BASE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PromptMentionLinkContext,
  type PromptMentionLinkResolver,
} from "./editor/prompt-mention-link";

export type ComposerEditorLayout = "thread" | "root-compose";

const COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT: Record<
  ComposerEditorLayout,
  string
> = {
  thread: "50dvh",
  "root-compose": "70dvh",
};

// TipTap's `blur` command defers to the next animation frame, so blur the
// editor DOM directly and drop the caret with it.
function blurComposerEditor(editor: Editor): void {
  editor.view.dom.blur();
  window.getSelection()?.removeAllRanges();
}

/** BB's editor region with the effects already resolved by the Composer host. */
export function ComposerEditorSlot({
  editor,
  scrollContainerRef,
  inputLocked,
  isZenMode,
  hasCompactControls,
  isCompactLayout,
  minHeight,
  layout,
  resolveMentionLink,
}: {
  editor: Editor | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  inputLocked: boolean;
  isZenMode: boolean;
  hasCompactControls: boolean;
  isCompactLayout: boolean;
  minHeight: number;
  layout: ComposerEditorLayout;
  resolveMentionLink: PromptMentionLinkResolver | undefined;
}) {
  return (
    <div
      ref={scrollContainerRef}
      data-promptbox-editor-scroll=""
      aria-busy={inputLocked || undefined}
      className={cn(
        "w-full overflow-y-auto bg-transparent px-4 pb-1 pr-14 pt-3 outline-none",
        COARSE_POINTER_TEXT_BASE_CLASS,
        // Keep line-height after the text-size class. tailwind-merge treats
        // text size utilities as owning line-height and would otherwise drop
        // this, making Composer rows tighter than timeline messages.
        "leading-relaxed",
        isZenMode && "min-h-0 flex-1",
        hasCompactControls && !isZenMode && "pr-14",
        isCompactLayout && "h-12 overflow-hidden pb-0 pr-14 pt-0",
      )}
      style={{
        minHeight: isZenMode
          ? "0px"
          : isCompactLayout
            ? "48px"
            : `${minHeight}px`,
        height: isZenMode ? "100%" : isCompactLayout ? "48px" : undefined,
        maxHeight: isZenMode
          ? "none"
          : isCompactLayout
            ? "48px"
            : COMPOSER_EDITOR_MAX_HEIGHT_BY_LAYOUT[layout],
      }}
    >
      <PromptMentionLinkContext.Provider value={resolveMentionLink ?? null}>
        <EditorContent
          editor={editor}
          // A plugin lock makes the editor non-editable, so ProseMirror skips
          // its own Escape handler. Release focus explicitly in that state.
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (editor === null || editor.isEditable) return;
            event.preventDefault();
            blurComposerEditor(editor);
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
      </PromptMentionLinkContext.Provider>
    </div>
  );
}
