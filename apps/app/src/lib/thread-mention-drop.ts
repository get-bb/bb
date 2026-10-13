import type { AuxiliaryDropTarget } from "./split-drag/splitDragSession";

export interface DroppedThreadMention {
  threadId: string;
  label: string;
}

const targets = new Map<
  HTMLElement,
  {
    accepts: () => boolean;
    insert: (thread: DroppedThreadMention, x: number, y: number) => void;
  }
>();

export function registerThreadMentionDropTarget(
  element: HTMLElement,
  target: {
    accepts: () => boolean;
    insert: (thread: DroppedThreadMention, x: number, y: number) => void;
  },
): () => void {
  targets.set(element, target);
  return () => {
    targets.delete(element);
  };
}

export function resolveThreadMentionDropTarget(
  x: number,
  y: number,
  thread: DroppedThreadMention,
): AuxiliaryDropTarget | null {
  for (const hit of document.elementsFromPoint(x, y)) {
    for (const [element, target] of targets) {
      if (!element.contains(hit) || !target.accepts()) continue;
      return {
        element,
        label: "Mention thread",
        drop: () => {
          if (element.isConnected && target.accepts())
            target.insert(thread, x, y);
        },
      };
    }
  }
  return null;
}
