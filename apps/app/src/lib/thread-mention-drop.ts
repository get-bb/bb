import type { AuxiliaryDropTarget } from "./split-drag/splitDragSession";

export interface DroppedThreadMention {
  threadId: string;
  label: string;
}

interface ThreadMentionDropTarget {
  accepts: () => boolean;
  insert: (
    threads: readonly DroppedThreadMention[],
    x: number,
    y: number,
  ) => void;
}

const targets = new Map<HTMLElement, ThreadMentionDropTarget>();

export function registerThreadMentionDropTarget(
  element: HTMLElement,
  target: ThreadMentionDropTarget,
): () => void {
  targets.set(element, target);
  return () => {
    targets.delete(element);
  };
}

export function resolveThreadMentionDropTarget(
  x: number,
  y: number,
  threads: readonly DroppedThreadMention[],
): AuxiliaryDropTarget | null {
  for (const hit of document.elementsFromPoint(x, y)) {
    for (const [element, target] of targets) {
      if (!element.contains(hit) || !target.accepts()) continue;
      return {
        element,
        label:
          threads.length === 1
            ? "Mention thread"
            : `Mention ${threads.length} threads`,
        drop: () => {
          if (element.isConnected && target.accepts())
            target.insert(threads, x, y);
        },
      };
    }
  }
  return null;
}
