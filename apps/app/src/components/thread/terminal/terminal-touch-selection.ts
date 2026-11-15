import type { IBuffer, Terminal } from "@xterm/xterm";

export const TERMINAL_TOUCH_SELECTION_HOLD_MS = 450;
export const TERMINAL_TOUCH_SELECTION_MOVEMENT_THRESHOLD_PX = 10;
export const TERMINAL_TOUCH_SELECTION_EDGE_SCROLL_INTERVAL_MS = 50;

export interface TerminalBufferCell {
  col: number;
  row: number;
}

export interface TerminalCellRange {
  start: TerminalBufferCell;
  end: TerminalBufferCell;
}

export interface TerminalScreenGeometry {
  cols: number;
  rows: number;
  screenRect: Pick<DOMRect, "left" | "top" | "width" | "height">;
  viewportY: number;
}

export interface TerminalSelectArgs {
  column: number;
  row: number;
  length: number;
}

type TouchSelectionTerminal = Pick<
  Terminal,
  "buffer" | "cols" | "element" | "rows" | "scrollLines" | "select"
>;

export type TerminalEdgeScrollDirection = -1 | 0 | 1;

interface AttachTerminalTouchSelectionArgs {
  surface: HTMLElement;
  getTerminal: () => TouchSelectionTerminal | null;
  onSelectionStart: () => void;
  onSelectionEnd: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function terminalCellFromClientPoint(
  point: { x: number; y: number },
  { cols, rows, screenRect, viewportY }: TerminalScreenGeometry,
): TerminalBufferCell | null {
  if (cols <= 0 || rows <= 0 || screenRect.width <= 0) {
    return null;
  }
  const cellWidth = screenRect.width / cols;
  const cellHeight = screenRect.height / rows;
  if (cellHeight <= 0) {
    return null;
  }
  const col = clamp(
    Math.floor((point.x - screenRect.left) / cellWidth),
    0,
    cols - 1,
  );
  const row = clamp(
    Math.floor((point.y - screenRect.top) / cellHeight),
    0,
    rows - 1,
  );
  return { col, row: viewportY + row };
}

export function terminalEdgeScrollDirection(
  pointY: number,
  { rows, screenRect }: TerminalScreenGeometry,
): TerminalEdgeScrollDirection {
  if (rows <= 0) {
    return 0;
  }
  const edgeZone = screenRect.height / rows;
  if (pointY < screenRect.top + edgeZone) {
    return -1;
  }
  if (pointY > screenRect.top + screenRect.height - edgeZone) {
    return 1;
  }
  return 0;
}

function isWordCell(buffer: IBuffer, col: number, row: number): boolean {
  const cell = buffer.getLine(row)?.getCell(col);
  if (cell === undefined) {
    return false;
  }
  if (cell.getWidth() === 0) {
    return true;
  }
  return /\S/.test(cell.getChars());
}

export function terminalWordRangeAt(
  buffer: IBuffer,
  cols: number,
  cell: TerminalBufferCell,
): TerminalCellRange {
  if (!isWordCell(buffer, cell.col, cell.row)) {
    return { start: cell, end: cell };
  }
  let startCol = cell.col;
  while (startCol > 0 && isWordCell(buffer, startCol - 1, cell.row)) {
    startCol -= 1;
  }
  let endCol = cell.col;
  while (endCol < cols - 1 && isWordCell(buffer, endCol + 1, cell.row)) {
    endCol += 1;
  }
  return {
    start: { col: startCol, row: cell.row },
    end: { col: endCol, row: cell.row },
  };
}

function cellOffset(cell: TerminalBufferCell, cols: number): number {
  return cell.row * cols + cell.col;
}

export function terminalSelectionForDrag(
  word: TerminalCellRange,
  focus: TerminalBufferCell,
  cols: number,
): TerminalSelectArgs {
  const focusOffset = cellOffset(focus, cols);
  const start = focusOffset < cellOffset(word.start, cols) ? focus : word.start;
  const end = focusOffset > cellOffset(word.end, cols) ? focus : word.end;
  return {
    column: start.col,
    row: start.row,
    length: cellOffset(end, cols) - cellOffset(start, cols) + 1,
  };
}

function screenGeometry(
  terminal: TouchSelectionTerminal,
): TerminalScreenGeometry | null {
  const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
  if (!screen) {
    return null;
  }
  return {
    cols: terminal.cols,
    rows: terminal.rows,
    screenRect: screen.getBoundingClientRect(),
    viewportY: terminal.buffer.active.viewportY,
  };
}

export function attachTerminalTouchSelection({
  surface,
  getTerminal,
  onSelectionStart,
  onSelectionEnd,
}: AttachTerminalTouchSelectionArgs): () => void {
  let holdTimer: number | null = null;
  let touchId: number | null = null;
  let startPoint = { x: 0, y: 0 };
  let word: TerminalCellRange | null = null;
  let lastPoint = { x: 0, y: 0 };
  let edgeScrollTimer: number | null = null;
  let edgeScrollDirection: TerminalEdgeScrollDirection = 0;

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const stopEdgeScroll = () => {
    if (edgeScrollTimer !== null) {
      window.clearInterval(edgeScrollTimer);
      edgeScrollTimer = null;
    }
    edgeScrollDirection = 0;
  };

  const selectTo = (point: { x: number; y: number }) => {
    lastPoint = point;
    const terminal = getTerminal();
    const geometry = terminal === null ? null : screenGeometry(terminal);
    if (terminal === null || geometry === null || word === null) {
      return null;
    }
    const focus = terminalCellFromClientPoint(point, geometry);
    if (focus === null) {
      return null;
    }
    const range = terminalSelectionForDrag(word, focus, terminal.cols);
    terminal.select(range.column, range.row, range.length);
    return geometry;
  };

  const updateEdgeScroll = (geometry: TerminalScreenGeometry | null) => {
    const direction =
      geometry === null
        ? 0
        : terminalEdgeScrollDirection(lastPoint.y, geometry);
    if (direction === edgeScrollDirection) {
      return;
    }
    stopEdgeScroll();
    if (direction === 0) {
      return;
    }
    edgeScrollDirection = direction;
    edgeScrollTimer = window.setInterval(() => {
      const terminal = getTerminal();
      if (terminal === null || word === null) {
        stopEdgeScroll();
        return;
      }
      terminal.scrollLines(edgeScrollDirection);
      selectTo(lastPoint);
    }, TERMINAL_TOUCH_SELECTION_EDGE_SCROLL_INTERVAL_MS);
  };

  const beginSelection = () => {
    holdTimer = null;
    const terminal = getTerminal();
    const geometry = terminal === null ? null : screenGeometry(terminal);
    if (terminal === null || geometry === null) {
      return;
    }
    const cell = terminalCellFromClientPoint(startPoint, geometry);
    if (cell === null) {
      return;
    }
    word = terminalWordRangeAt(terminal.buffer.active, terminal.cols, cell);
    onSelectionStart();
    selectTo(startPoint);
  };

  const findTrackedTouch = (touches: TouchList): Touch | null => {
    for (const touch of Array.from(touches)) {
      if (touch.identifier === touchId) {
        return touch;
      }
    }
    return null;
  };

  const reset = () => {
    clearHoldTimer();
    stopEdgeScroll();
    const wasSelecting = word !== null;
    touchId = null;
    word = null;
    if (wasSelecting) {
      onSelectionEnd();
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    reset();
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    if (touch === undefined) {
      return;
    }
    touchId = touch.identifier;
    startPoint = { x: touch.clientX, y: touch.clientY };
    holdTimer = window.setTimeout(
      beginSelection,
      TERMINAL_TOUCH_SELECTION_HOLD_MS,
    );
  };

  const handleTouchMove = (event: TouchEvent) => {
    const touch = findTrackedTouch(event.touches);
    if (touch === null || event.touches.length !== 1) {
      reset();
      return;
    }
    const point = { x: touch.clientX, y: touch.clientY };
    if (word === null) {
      if (
        Math.hypot(point.x - startPoint.x, point.y - startPoint.y) >
        TERMINAL_TOUCH_SELECTION_MOVEMENT_THRESHOLD_PX
      ) {
        clearHoldTimer();
        touchId = null;
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateEdgeScroll(selectTo(point));
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (touchId !== null && findTrackedTouch(event.changedTouches) !== null) {
      reset();
    }
  };

  const handleContextMenu = (event: Event) => {
    if (touchId !== null) {
      event.preventDefault();
    }
  };

  surface.addEventListener("touchstart", handleTouchStart, { passive: true });
  surface.addEventListener("touchmove", handleTouchMove, {
    capture: true,
    passive: false,
  });
  surface.addEventListener("touchend", handleTouchEnd);
  surface.addEventListener("touchcancel", reset);
  surface.addEventListener("contextmenu", handleContextMenu);
  return () => {
    clearHoldTimer();
    stopEdgeScroll();
    surface.removeEventListener("touchstart", handleTouchStart);
    surface.removeEventListener("touchmove", handleTouchMove, {
      capture: true,
    });
    surface.removeEventListener("touchend", handleTouchEnd);
    surface.removeEventListener("touchcancel", reset);
    surface.removeEventListener("contextmenu", handleContextMenu);
  };
}
