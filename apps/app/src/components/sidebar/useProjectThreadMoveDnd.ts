import { useCallback, useState, type MouseEventHandler } from "react";
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Modifier,
} from "@dnd-kit/core";
import { closestCenter, pointerWithin } from "@dnd-kit/core";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";

const PROJECT_THREAD_MOVE_ID_PREFIX = "thread-move:";

export interface ProjectThreadMoveDndState {
  activeThreadId: string | null;
  sourceProjectId: string | null;
  consumeClickSuppression: ConsumeDragClickSuppression;
  onClickCapture: MouseEventHandler<HTMLElement>;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragStart: (event: DragStartEvent) => void;
  overProjectId: string | null;
}

export function getProjectThreadMoveId(threadId: string): string {
  return `${PROJECT_THREAD_MOVE_ID_PREFIX}${threadId}`;
}

export function isProjectThreadMoveId(value: string): boolean {
  return value.startsWith(PROJECT_THREAD_MOVE_ID_PREFIX);
}

export function getThreadIdFromProjectThreadMoveId(
  value: string,
): string | null {
  if (!isProjectThreadMoveId(value)) {
    return null;
  }
  const threadId = value.slice(PROJECT_THREAD_MOVE_ID_PREFIX.length);
  return threadId.length > 0 ? threadId : null;
}

export function getProjectIdFromProjectDropTarget(
  value: string,
): string | null {
  const projectPrefix = value.startsWith("project-drop:")
    ? "project-drop:"
    : value.startsWith("project:")
      ? "project:"
      : null;
  if (!projectPrefix) {
    return null;
  }
  const projectId = value.slice(projectPrefix.length);
  return projectId.length > 0 ? projectId : null;
}

export function getProjectThreadDropTargetId(projectId: string): string {
  return `project-drop:${projectId}`;
}

interface ProjectThreadMoveTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export function projectThreadMoveTransform(
  activeId: string | number | null | undefined,
  transform: ProjectThreadMoveTransform,
): ProjectThreadMoveTransform {
  return typeof activeId === "string" && isProjectThreadMoveId(activeId)
    ? transform
    : { ...transform, x: 0 };
}

/**
 * Project moves share the sidebar DnD context with vertical reordering. Keep
 * reorder drags vertical, but let a project-thread ghost follow the pointer
 * horizontally out of the sidebar like split dragging does.
 */
export const projectThreadMoveModifiers: Modifier[] = [
  ({ active, transform }) => projectThreadMoveTransform(active?.id, transform),
];

/**
 * Project rows contain nested sidebar droppables for thread/section ordering.
 * While a project-move drag is active, prefer the enclosing project target so
 * dropping anywhere in a project's expanded tree still means "move here".
 */
export const projectThreadMoveCollisionDetection: CollisionDetection = (
  args,
) => {
  const pointerCollisions = pointerWithin(args);
  if (
    typeof args.active.id === "string" &&
    isProjectThreadMoveId(args.active.id)
  ) {
    const projectCollision = pointerCollisions.find(
      (collision) =>
        typeof collision.id === "string" &&
        isAllowedProjectThreadMoveTarget(
          getProjectIdFromProjectDropTarget(collision.id),
        ),
    );
    if (projectCollision) {
      return [projectCollision];
    }

    // A project move is a pointer-driven cross-sidebar action. Do not fall
    // back to the nearest sidebar item when the pointer has left the sidebar:
    // that would turn an intentional cancel into an accidental move.
    return [];
  }
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

interface UseProjectThreadMoveDndArgs {
  onMove: (threadId: string, projectId: string) => void;
  threadProjectIds: ReadonlyMap<string, string>;
}

interface ProjectThreadMoveTargetArgs {
  activeThreadId: string | null;
  overTargetId: string | null;
  threadProjectIds: ReadonlyMap<string, string>;
}

export function getProjectThreadMoveTargetProjectId({
  activeThreadId,
  overTargetId,
  threadProjectIds,
}: ProjectThreadMoveTargetArgs): string | null {
  if (!activeThreadId || !overTargetId) {
    return null;
  }
  const projectId = getProjectIdFromProjectDropTarget(overTargetId);
  if (
    !isAllowedProjectThreadMoveTarget(projectId) ||
    threadProjectIds.get(activeThreadId) === projectId
  ) {
    return null;
  }
  return projectId;
}

function isAllowedProjectThreadMoveTarget(
  projectId: string | null,
): projectId is string {
  return projectId !== null;
}

export function useProjectThreadMoveDnd({
  onMove,
  threadProjectIds,
}: UseProjectThreadMoveDndArgs): ProjectThreadMoveDndState {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sourceProjectId, setSourceProjectId] = useState<string | null>(null);
  const [overProjectId, setOverProjectId] = useState<string | null>(null);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      if (typeof event.active.id !== "string") return;
      const threadId = getThreadIdFromProjectThreadMoveId(event.active.id);
      if (!threadId) return;
      setActiveThreadId(threadId);
      setSourceProjectId(threadProjectIds.get(threadId) ?? null);
      setOverProjectId(null);
      beginDragClickSuppression();
    },
    [beginDragClickSuppression, threadProjectIds],
  );

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      if (typeof event.active.id !== "string") return;
      const activeThreadId = getThreadIdFromProjectThreadMoveId(
        event.active.id,
      );
      if (!activeThreadId) return;
      setOverProjectId(
        getProjectThreadMoveTargetProjectId({
          activeThreadId,
          overTargetId:
            typeof event.over?.id === "string" ? event.over.id : null,
          threadProjectIds,
        }),
      );
    },
    [threadProjectIds],
  );

  const resetDrag = useCallback(() => {
    setActiveThreadId(null);
    setSourceProjectId(null);
    setOverProjectId(null);
    clearDragClickSuppressionSoon();
  }, [clearDragClickSuppressionSoon]);

  const onDragCancel = useCallback(() => {
    if (activeThreadId === null) return;
    resetDrag();
  }, [activeThreadId, resetDrag]);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const threadId =
        typeof event.active.id === "string"
          ? getThreadIdFromProjectThreadMoveId(event.active.id)
          : null;
      const projectId = getProjectThreadMoveTargetProjectId({
        activeThreadId: threadId,
        overTargetId: typeof event.over?.id === "string" ? event.over.id : null,
        threadProjectIds,
      });
      resetDrag();
      if (threadId && projectId) {
        onMove(threadId, projectId);
      }
    },
    [onMove, resetDrag, threadProjectIds],
  );

  const onClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );

  return {
    activeThreadId,
    consumeClickSuppression: consumeDragClickSuppression,
    onClickCapture,
    onDragCancel,
    onDragEnd,
    onDragOver,
    onDragStart,
    overProjectId,
    sourceProjectId,
  };
}
