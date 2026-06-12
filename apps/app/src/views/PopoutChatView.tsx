import { useCallback, useEffect, useRef, useState } from "react";
import { RootComposeView } from "./RootComposeView";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  getBbDesktopInfo,
} from "@/lib/bb-desktop";
import { BB_DESKTOP_POPOUT_HEIGHT_MIN } from "@bb/server-contract";
import type { BbDesktopPopoutThreadChangedPayload } from "@bb/server-contract";

const POPOUT_DRAG_REGION_HEIGHT = 20;

function focusPromptEditor(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  });
}

export function PopoutChatView() {
  const desktop = getBbDesktopInfo();
  const popout = desktop?.popout ?? null;
  const contentRef = useRef<HTMLDivElement>(null);
  const [, setThread] = useState<BbDesktopPopoutThreadChangedPayload>(null);
  const handleEscapeEmptyPrompt = useCallback(() => {
    popout?.toggle();
  }, [popout]);

  useEffect(() => {
    if (popout === null) {
      return;
    }
    return popout.onThreadChanged((nextThread) => {
      setThread(nextThread);
      focusPromptEditor();
    });
  }, [popout]);

  useEffect(() => {
    if (popout === null || contentRef.current === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) {
        return;
      }
      popout.requestResize({
        height: Math.max(
          BB_DESKTOP_POPOUT_HEIGHT_MIN,
          Math.ceil(entry.contentRect.height) + POPOUT_DRAG_REGION_HEIGHT,
        ),
      });
    });
    observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
    };
  }, [popout]);

  if (popout === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        Popout chat is only available in the desktop app.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className={`${MACOS_WINDOW_DRAG_CLASS} h-5 shrink-0`} />
      <div
        ref={contentRef}
        className={`${MACOS_APP_REGION_NO_DRAG_CLASS} shrink-0 px-3 pb-3 pt-1`}
      >
        <RootComposeView
          surface="popout"
          onEscapeEmptyPrompt={handleEscapeEmptyPrompt}
        />
      </div>
    </div>
  );
}
