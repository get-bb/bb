import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { experimental_VoiceInputTextarea as VoiceInputTextarea } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { cn } from "@/lib/utils";
import { usePortalScopeProps } from "@/lib/portal-scope";

const GAP = 6;
const MARGIN = 8;
const MIN_KEYBOARD_PX = 80;

function useAnchoredPosition(anchor: () => DOMRect | null, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const anchorRef = useRef(anchor);

  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  useLayoutEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const card = ref.current;
      if (!card) return;
      const { width, height } = card.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = anchorRef.current();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setStyle({ left: Math.max(MARGIN, (vw - width) / 2), bottom: 160 });
        return;
      }
      const below = rect.bottom + GAP;
      const top =
        below + height <= vh - MARGIN || rect.top - GAP - height < MARGIN
          ? below
          : rect.top - GAP - height;
      const left = Math.min(Math.max(MARGIN, rect.left), vw - width - MARGIN);
      setStyle({
        left,
        top: Math.min(Math.max(MARGIN, top), vh - height - MARGIN),
      });
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const observer = new ResizeObserver(queue);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("scroll", queue, true);
    window.addEventListener("resize", queue);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", queue, true);
      window.removeEventListener("resize", queue);
    };
  }, [enabled]);

  return { ref, style };
}

function useKeyboardInset(enabled: boolean) {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const covered = Math.round(
        document.documentElement.clientHeight -
          (viewport.height + viewport.offsetTop),
      );
      setInset(
        viewport.scale === 1 && covered >= MIN_KEYBOARD_PX ? covered : 0,
      );
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener("resize", queue);
    viewport.addEventListener("scroll", queue);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", queue);
      viewport.removeEventListener("scroll", queue);
    };
  }, [enabled]);

  return enabled ? inset : 0;
}

export function CommentCard({
  mode,
  quote,
  initialBody,
  anchor,
  busy,
  onSubmit,
  onDelete,
  onCancel,
}: {
  mode: "create" | "edit";
  quote: string;
  initialBody: string;
  anchor: () => DOMRect | null;
  busy: boolean;
  onSubmit: (body: string) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const sheet = useIsCompactViewport();
  const touch = usePointerCoarse();
  const [body, setBody] = useState(initialBody);
  const [recording, setRecording] = useState(false);
  const { ref, style } = useAnchoredPosition(anchor, !sheet);
  const keyboardInset = useKeyboardInset(sheet);
  const portalScopeProps = usePortalScopeProps();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = body !== initialBody;
  const holdOpenRef = useRef(false);
  holdOpenRef.current = dirty || recording;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (sheet) window.getSelection()?.removeAllRanges();
    const frame = requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const max = sheet ? Math.round(window.innerHeight * 0.3) : 180;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
  }, [body, sheet, keyboardInset]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      if (!holdOpenRef.current) cancelRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [ref]);

  const empty = body.trim() === "";
  const canSubmit =
    !busy && !recording && !empty && (mode === "create" || dirty);
  const submit = () => {
    if (canSubmit) onSubmit(body.trim());
  };

  const sheetStyle: CSSProperties = {
    bottom: keyboardInset,
    paddingBottom: keyboardInset ? undefined : "env(safe-area-inset-bottom)",
  };

  const card = (
    <div
      {...portalScopeProps}
      ref={ref}
      role="dialog"
      aria-label={mode === "create" ? "Add comment" : "Edit comment"}
      data-docs-annotation-card=""
      style={sheet ? sheetStyle : style}
      className={cn(
        "fixed z-50 overflow-hidden border border-border bg-popover text-sm text-popover-foreground shadow-lg",
        sheet
          ? "inset-x-0 rounded-t-xl border-x-0 border-b-0"
          : "w-[min(28rem,calc(100vw-1rem))] rounded-lg",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !recording) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {sheet && (
        <p className="mx-3 mt-3 line-clamp-2 break-words border-l-2 border-border pl-2 text-sm leading-5 text-muted-foreground">
          {quote}
        </p>
      )}
      <VoiceInputTextarea
        ref={textareaRef}
        aria-label="Comment"
        rows={sheet ? 2 : 1}
        maxLength={10000}
        value={body}
        disabled={busy}
        placeholder="Add a comment"
        className={cn(
          "block w-full resize-none bg-transparent pl-3 text-foreground outline-none placeholder:text-muted-foreground",
          sheet ? "pt-3 text-base leading-6" : "pt-2.5 text-sm leading-5",
          touch ? "pr-10" : "pr-8",
          recording ? (touch ? "pb-14" : "pb-12") : sheet ? "pb-3" : "pb-2.5",
        )}
        onValueChange={setBody}
        onVoiceInputActiveChange={setRecording}
        onKeyDown={(event) => {
          if (
            touch ||
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }
          event.preventDefault();
          submit();
        }}
      />
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-t border-border",
          sheet ? "px-2 py-2" : "px-1.5 py-1.5",
        )}
      >
        {onDelete ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || recording}
            className={cn(
              "gap-1.5 text-muted-foreground hover:text-destructive",
              touch ? "h-10 px-3" : "h-7 px-2",
            )}
            onClick={onDelete}
          >
            <Icon
              name="Trash2"
              className={touch ? "size-4" : "size-3.5"}
              aria-hidden
            />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            className={touch ? "h-10 px-3" : "h-7 px-2"}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            className={touch ? "h-10 px-4" : "h-7 px-2.5"}
            onClick={submit}
          >
            {mode === "create" ? "Add" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!sheet) return card;
  return (
    <>
      <div
        {...portalScopeProps}
        aria-hidden
        className="fixed inset-0 z-50 bg-black/20"
      />
      {card}
    </>
  );
}
