import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  anchorPointFromMouseEvent,
  selectionAnchorFromPointerRelease,
  type MessageProseSelection,
  type SelectionAnchor,
  type SelectionAnchorPoint,
} from "@/components/thread/timeline/SelectableMessageProse.js";
import { TimelineSelectionMenu } from "@/components/thread/timeline/TimelineSelectionMenu.js";

interface SecondaryPanelSelectionActionsProps {
  children: ReactNode;
  className?: string;
  onSelectionAddToChat?: (text: string) => void;
}

function firstClientRect(range: Range): DOMRect | null {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (rect === null) {
      continue;
    }
    if (rect.width > 0 || rect.height > 0) {
      return rect;
    }
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function isEventTargetWithinNode(
  event: Event,
  node: HTMLElement | null,
): boolean {
  if (node === null || !(event.target instanceof Node)) return false;
  return node.contains(event.target);
}

function selectionRangeTouchesNode(range: Range, node: HTMLElement): boolean {
  const { commonAncestorContainer } = range;
  if (node.contains(commonAncestorContainer)) {
    return true;
  }
  if (
    typeof range.intersectsNode === "function" &&
    (() => {
      try {
        return range.intersectsNode(node);
      } catch {
        return false;
      }
    })()
  ) {
    return true;
  }
  return false;
}

function readSelectionWithinPanel({
  anchor,
  node,
  pointerStartedInNode,
}: {
  anchor: SelectionAnchor | null;
  node: HTMLElement | null;
  pointerStartedInNode: boolean;
}): MessageProseSelection | null {
  if (node === null || typeof window === "undefined") return null;

  const selection = window.getSelection();
  if (
    selection === null ||
    selection.rangeCount === 0 ||
    selection.isCollapsed
  ) {
    return null;
  }

  const text = selection.toString().trim();
  if (text.length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!pointerStartedInNode && !selectionRangeTouchesNode(range, node)) {
    return null;
  }

  const selectionAnchor = anchor ?? null;
  const rect =
    firstClientRect(range) ??
    (selectionAnchor === null
      ? node.getBoundingClientRect()
      : new DOMRect(selectionAnchor.point.x, selectionAnchor.point.y, 0, 0));
  const nextSelection: MessageProseSelection = { text, rect };
  if (selectionAnchor !== null) {
    nextSelection.anchorPoint = selectionAnchor.point;
    nextSelection.anchorSide = selectionAnchor.side;
  }
  return nextSelection;
}

export function SecondaryPanelSelectionActions({
  children,
  className,
  onSelectionAddToChat,
}: SecondaryPanelSelectionActionsProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const pointerStartedInNodeRef = useRef(false);
  const pointerStartPointRef = useRef<SelectionAnchorPoint | null>(null);
  const pointerIsDownRef = useRef(false);
  const lastPointerReleaseAnchorRef = useRef<SelectionAnchor | null>(null);
  const isPointerCoarse = usePointerCoarse();
  const [selection, setSelection] = useState<MessageProseSelection | null>(
    null,
  );
  const isEnabled = !isPointerCoarse;

  const dismissSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const reportSelection = useCallback((anchor: SelectionAnchor | null) => {
    setSelection(
      readSelectionWithinPanel({
        anchor,
        node: nodeRef.current,
        pointerStartedInNode: pointerStartedInNodeRef.current,
      }),
    );
  }, []);

  useEffect(() => {
    if (!isEnabled || typeof window === "undefined") return;

    let frame: number | null = null;
    const cancelFrame = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const scheduleReport = (anchor: SelectionAnchor | null = null) => {
      cancelFrame();
      frame = window.requestAnimationFrame(() => {
        frame = null;
        reportSelection(anchor);
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      cancelFrame();
      pointerStartedInNodeRef.current = isEventTargetWithinNode(
        event,
        nodeRef.current,
      );
      pointerStartPointRef.current = pointerStartedInNodeRef.current
        ? anchorPointFromMouseEvent(event)
        : null;
      pointerIsDownRef.current = true;
    };
    const handlePointerRelease = (event: PointerEvent | MouseEvent) => {
      const anchor =
        pointerStartedInNodeRef.current && pointerStartPointRef.current !== null
          ? selectionAnchorFromPointerRelease(
              pointerStartPointRef.current,
              event,
            )
          : null;
      if (anchor !== null) {
        lastPointerReleaseAnchorRef.current = anchor;
      }
      pointerIsDownRef.current = false;
      pointerStartPointRef.current = null;
      scheduleReport(anchor ?? lastPointerReleaseAnchorRef.current);
    };
    const handlePointerCancel = () => {
      pointerIsDownRef.current = false;
      pointerStartPointRef.current = null;
      scheduleReport(lastPointerReleaseAnchorRef.current);
    };
    const handleSelectionChange = () => {
      if (pointerIsDownRef.current) {
        return;
      }
      scheduleReport(lastPointerReleaseAnchorRef.current);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointerup", handlePointerRelease);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("mouseup", handlePointerRelease);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keyup", handleSelectionChange);
    return () => {
      cancelFrame();
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerRelease);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("mouseup", handlePointerRelease);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keyup", handleSelectionChange);
    };
  }, [isEnabled, reportSelection]);

  const handleAddToChat = useCallback(
    (text: string) => {
      onSelectionAddToChat?.(text);
      setSelection(null);
    },
    [onSelectionAddToChat],
  );

  if (!isEnabled) {
    return <>{children}</>;
  }

  return (
    <>
      <div ref={nodeRef} className={className}>
        {children}
      </div>
      <TimelineSelectionMenu
        selection={selection}
        onAddToChat={
          onSelectionAddToChat === undefined ? undefined : handleAddToChat
        }
        onDismiss={dismissSelection}
      />
    </>
  );
}
