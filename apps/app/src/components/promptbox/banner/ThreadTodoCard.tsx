import type {
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const TODO_CARD_ROW_HEIGHT = 32;

const STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

export interface ThreadTodoCardProps {
  pendingTodos: ThreadTimelinePendingTodos | null;
  isExpanded: boolean;
  onToggle: () => void;
}

const BODY_ID = "thread-todo-card-body";
const TOGGLE_ID = "thread-todo-card-toggle";

function getTodoSummary(items: readonly ThreadTimelinePendingTodoItem[]): {
  visible: string;
  aria: string;
} {
  let completedCount = 0;
  for (const item of items) {
    if (item.status === "completed") completedCount += 1;
  }
  return {
    visible: `${completedCount}/${items.length} complete`,
    aria: `${completedCount} of ${items.length} ${
      items.length === 1 ? "item" : "items"
    } complete`,
  };
}

function TodoStatusIcon({
  status,
}: {
  status: ThreadTimelinePendingTodoItemStatus;
}) {
  const className = "size-3.5 shrink-0";
  switch (status) {
    case "in_progress":
      return (
        <Icon
          name="Square"
          className={cn(className, "fill-current text-muted-foreground/30")}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <Icon
          name="Check"
          className={cn(className, "text-muted-foreground/60")}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Icon
          name="Square"
          className={cn(className, "text-muted-foreground/45")}
          aria-hidden="true"
        />
      );
  }
}

function TodoBody({
  items,
}: {
  items: readonly ThreadTimelinePendingTodoItem[];
}) {
  const ordered = [...items].sort(
    (a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status],
  );
  return (
    <ul className="max-h-40 space-y-0.5 overflow-y-auto px-3 pb-2 pt-1.5">
      {ordered.map((item) => (
        <li
          key={item.id}
          className="flex min-w-0 items-center gap-2 py-0.5 text-xs"
        >
          <TodoStatusIcon status={item.status} />
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              item.status === "in_progress" && "font-medium text-foreground",
              item.status === "pending" && "text-muted-foreground",
              item.status === "completed" &&
                "text-subtle-foreground line-through decoration-subtle-foreground",
            )}
            title={item.text}
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ThreadTodoCard({
  pendingTodos,
  isExpanded,
  onToggle,
}: ThreadTodoCardProps) {
  const items = pendingTodos?.items ?? [];
  if (items.length === 0) {
    return null;
  }
  const summary = getTodoSummary(items);
  return (
    <PromptStackCard
      ariaLabel="To-do list"
      className="overflow-hidden"
      style={{ minHeight: TODO_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label={`To-do list: ${summary.aria}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon
            name="ListTodo"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground opacity-70">
            {summary.visible}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      <section
        id={BODY_ID}
        role="region"
        aria-labelledby={TOGGLE_ID}
        aria-hidden={!isExpanded}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
          isExpanded
            ? "grid-rows-[1fr] border-t border-border opacity-100"
            : "pointer-events-none grid-rows-[0fr] border-t border-transparent opacity-0",
        )}
      >
        <div className="overflow-hidden bg-popover">
          <TodoBody items={items} />
        </div>
      </section>
    </PromptStackCard>
  );
}
