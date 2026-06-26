import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import type { MessageProseSelection } from "@/components/thread/timeline/SelectableMessageProse.js";
import { TimelineSelectionMenu } from "@/components/thread/timeline/TimelineSelectionMenu.js";

export interface PierreLineSelectionAnchorPoint {
  x: number;
  y: number;
}

export interface UsePierreLineSelectionActionsArgs {
  buildFallbackSelectionText?: (args: {
    containerElement: HTMLElement | null;
    range: SelectedLineRange;
  }) => string | null;
  buildSelectionText: (range: SelectedLineRange) => string | null;
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onSelectionAddToChat?: (text: string) => void;
  resolveAnchorPoint?: (args: {
    containerElement: HTMLElement | null;
    pointerAnchorPoint: PierreLineSelectionAnchorPoint | null;
    range: SelectedLineRange;
  }) => PierreLineSelectionAnchorPoint | null;
}

export interface PierreLineSelectionActions {
  menu: ReactNode;
  onLineSelectionChange: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd: (range: SelectedLineRange | null) => void;
  onLineSelectionStart: (range: SelectedLineRange | null) => void;
  onGutterUtilityClick: (range: SelectedLineRange) => void;
  onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMoveCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUpCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  selectedRange: SelectedLineRange | null;
}

function anchorPointFromPointerEvent(
  event: Pick<ReactPointerEvent<HTMLElement>, "clientX" | "clientY">,
): PierreLineSelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

function fallbackAnchorPoint(
  containerElement: HTMLElement | null,
): PierreLineSelectionAnchorPoint {
  const rect = containerElement?.getBoundingClientRect();
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return { x: rect.left + 24, y: rect.top + 24 };
}

function buildMenuSelection({
  containerElement,
  pointerAnchorPoint,
  text,
}: {
  containerElement: HTMLElement | null;
  pointerAnchorPoint: PierreLineSelectionAnchorPoint | null;
  text: string;
}): MessageProseSelection | null {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return null;
  }

  const anchorPoint =
    pointerAnchorPoint ?? fallbackAnchorPoint(containerElement);
  return {
    text: trimmedText,
    rect: new DOMRect(anchorPoint.x, anchorPoint.y, 0, 0),
    anchorPoint,
    anchorSide: "top",
  };
}

function areSelectedLineRangesEqual(
  first: SelectedLineRange | null,
  second: SelectedLineRange | null,
) {
  if (first === second) {
    return true;
  }
  if (first === null || second === null) {
    return false;
  }
  return (
    first.start === second.start &&
    first.end === second.end &&
    first.side === second.side &&
    first.endSide === second.endSide
  );
}

export function usePierreLineSelectionActions({
  buildFallbackSelectionText,
  buildSelectionText,
  containerRef,
  enabled,
  onSelectionAddToChat,
  resolveAnchorPoint,
}: UsePierreLineSelectionActionsArgs): PierreLineSelectionActions {
  const [activeRange, setActiveRange] = useState<SelectedLineRange | null>(
    null,
  );
  const [previewRange, setPreviewRange] = useState<SelectedLineRange | null>(
    null,
  );
  const [activeSelection, setActiveSelection] =
    useState<MessageProseSelection | null>(null);
  const lastPointerAnchorPointRef =
    useRef<PierreLineSelectionAnchorPoint | null>(null);
  const suppressedSelectionEndRangeRef = useRef<SelectedLineRange | null>(null);

  const capturePointerAnchorPoint = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      lastPointerAnchorPointRef.current = anchorPointFromPointerEvent(event);
    },
    [],
  );

  const dismissSelection = useCallback(() => {
    setActiveRange(null);
    setPreviewRange(null);
    setActiveSelection(null);
  }, []);

  const handleGutterUtilityClick = useCallback(
    (range: SelectedLineRange) => {
      if (!enabled) {
        return;
      }
      const containerElement = containerRef.current;
      const selectionText =
        buildSelectionText(range) ??
        buildFallbackSelectionText?.({
          containerElement,
          range,
        }) ??
        "";
      const pointerAnchorPoint = lastPointerAnchorPointRef.current;
      const anchorPoint =
        resolveAnchorPoint?.({
          containerElement,
          pointerAnchorPoint,
          range,
        }) ?? pointerAnchorPoint;
      const selection = buildMenuSelection({
        containerElement,
        pointerAnchorPoint: anchorPoint,
        text: selectionText,
      });
      if (selection === null) {
        suppressedSelectionEndRangeRef.current = range;
        setActiveRange(null);
        setPreviewRange(null);
        setActiveSelection(null);
        return;
      }
      suppressedSelectionEndRangeRef.current = null;
      setActiveRange(range);
      setPreviewRange(range);
      setActiveSelection(selection);
    },
    [
      buildFallbackSelectionText,
      buildSelectionText,
      containerRef,
      enabled,
      resolveAnchorPoint,
    ],
  );

  const handleLineSelectionStart = useCallback(
    (range: SelectedLineRange | null) => {
      if (!enabled) {
        return;
      }
      suppressedSelectionEndRangeRef.current = null;
      setActiveRange(null);
      setActiveSelection(null);
      setPreviewRange(range);
    },
    [enabled],
  );

  const handleLineSelectionChange = useCallback(
    (range: SelectedLineRange | null) => {
      if (!enabled) {
        return;
      }
      suppressedSelectionEndRangeRef.current = null;
      setPreviewRange(range);
    },
    [enabled],
  );

  const handleLineSelectionEnd = useCallback(
    (range: SelectedLineRange | null) => {
      if (!enabled) {
        return;
      }
      if (
        areSelectedLineRangesEqual(
          range,
          suppressedSelectionEndRangeRef.current,
        )
      ) {
        suppressedSelectionEndRangeRef.current = null;
        setPreviewRange(null);
        return;
      }
      setPreviewRange(range);
    },
    [enabled],
  );

  const handleSelectionAddToChat = useCallback(
    (text: string) => {
      onSelectionAddToChat?.(text);
      dismissSelection();
    },
    [dismissSelection, onSelectionAddToChat],
  );

  const menu = useMemo(
    () =>
      enabled ? (
        <TimelineSelectionMenu
          selection={activeSelection}
          onAddToChat={
            onSelectionAddToChat === undefined
              ? undefined
              : handleSelectionAddToChat
          }
          onDismiss={dismissSelection}
        />
      ) : null,
    [
      activeSelection,
      dismissSelection,
      enabled,
      handleSelectionAddToChat,
      onSelectionAddToChat,
    ],
  );

  return {
    menu,
    onGutterUtilityClick: handleGutterUtilityClick,
    onLineSelectionChange: handleLineSelectionChange,
    onLineSelectionEnd: handleLineSelectionEnd,
    onLineSelectionStart: handleLineSelectionStart,
    onPointerDownCapture: capturePointerAnchorPoint,
    onPointerMoveCapture: capturePointerAnchorPoint,
    onPointerUpCapture: capturePointerAnchorPoint,
    selectedRange: activeRange ?? previewRange,
  };
}
