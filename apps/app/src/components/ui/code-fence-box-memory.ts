import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";

export interface CodeFenceBox {
  width: number;
  height: number;
  marginTop: number;
  marginBottom: number;
}

const codeFenceBoxSchema = z.object({
  width: z.number(),
  height: z.number(),
  marginTop: z.number(),
  marginBottom: z.number(),
});

const MESSAGE_LIMIT = 500;
const WIDTHS_PER_FENCE = 3;
const SAME_BOX_TOLERANCE_PX = 0.5;

const cache = createLastKnownCache({
  prefix: "bb.code-fence-boxes",
  version: "1",
  schema: z.record(z.string(), z.array(codeFenceBoxSchema)),
  maxEntries: MESSAGE_LIMIT,
});

type MessageBoxes = Readonly<Record<string, CodeFenceBox[]>>;

const boxesByMessage = new Map<string, MessageBoxes>();

function messageBoxes(messageId: string): MessageBoxes {
  const known = boxesByMessage.get(messageId);
  if (known !== undefined) return known;
  const stored = cache.read(cache.key(messageId)) ?? {};
  boxesByMessage.set(messageId, stored);
  return stored;
}

function closeTo(left: number, right: number): boolean {
  return Math.abs(left - right) < SAME_BOX_TOLERANCE_PX;
}

function sameBox(left: CodeFenceBox, right: CodeFenceBox): boolean {
  return (
    closeTo(left.width, right.width) &&
    closeTo(left.height, right.height) &&
    closeTo(left.marginTop, right.marginTop) &&
    closeTo(left.marginBottom, right.marginBottom)
  );
}

export function recallCodeFenceBox(
  messageId: string,
  offset: number,
  width: number,
): CodeFenceBox | null {
  const boxes = messageBoxes(messageId)[String(offset)] ?? [];
  return boxes.find((box) => closeTo(box.width, width)) ?? null;
}

export function rememberCodeFenceBox(
  messageId: string,
  offset: number,
  box: CodeFenceBox,
): void {
  const boxes = messageBoxes(messageId);
  const widths = boxes[String(offset)] ?? [];
  if (widths[0] !== undefined && sameBox(widths[0], box)) return;
  const next = {
    ...boxes,
    [String(offset)]: [
      box,
      ...widths.filter((known) => !closeTo(known.width, box.width)),
    ].slice(0, WIDTHS_PER_FENCE),
  };
  boxesByMessage.set(messageId, next);
  cache.write(cache.key(messageId), next);
}

export function measureCodeFenceBox(element: HTMLElement): CodeFenceBox | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const previous = element.previousElementSibling?.getBoundingClientRect();
  const next = element.nextElementSibling?.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    marginTop:
      previous === undefined ? 0 : Math.max(0, rect.top - previous.bottom),
    marginBottom: next === undefined ? 0 : Math.max(0, next.top - rect.bottom),
  };
}

export function resetCodeFenceBoxMemoryForTest(): void {
  boxesByMessage.clear();
  cache.clear();
}
