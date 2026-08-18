import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { Disc } from "./Disc";
import { parentOf, threadDisplayTitle } from "./inbox";

/**
 * The way back out of a child thread.
 *
 * The flat list hides a child while its parent is on screen, so opening a
 * child from the parent's header chip leaves the user with no route back. This
 * chip names the parent and opens it. The disc repeats the parent's colour
 * from the list, so the chip points at a thread the user can recognise.
 */
export function ParentChip({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { threads } = useSidebarThreads();
  const actions = useSidebarThreadActions();

  const parent = parentOf(threads, threadId);
  if (parent === null) return null;

  const title = threadDisplayTitle(parent);

  return (
    <button
      type="button"
      aria-label={`Back to parent: ${title}`}
      title={title}
      onClick={() => actions.open(parent.id)}
      className={cn(
        "flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border text-2xs text-muted-foreground",
        "hover:bg-accent hover:text-foreground",
        isCompactViewport ? "px-1.5" : "px-2",
      )}
    >
      <Icon name="ChevronLeft" className="size-3 shrink-0" aria-hidden />
      <Disc thread={parent} />
      {isCompactViewport ? null : <span className="truncate">{title}</span>}
    </button>
  );
}
