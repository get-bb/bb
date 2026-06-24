import type {
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
  activityTextClass,
  type ActivityRowState,
} from "@/components/ui/activity-row-styles";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const TODO_CARD_ROW_HEIGHT = 32;

const STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const STATUS_ACTIVITY_STATE: Record<
  ThreadTimelinePendingTodoItemStatus,
  ActivityRowState
> = {
  in_progress: "active",
  pending: "pending",
  completed: "completed",
};

export interface ThreadTodoCardProps {
  pendingTodos: ThreadTimelinePendingTodos | null;
  isExpanded: boolean;
  onToggle: () => void;
}

const BODY_ID = "thread-todo-card-body";
const TOGGLE_ID = "thread-todo-card-toggle";
const TODO_HEADER_BUTTON_CLASS = activityRowClass(
  "active",
  "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80",
);
const TODO_ACTIVE_ROW_CLASS = "shadow-none ring-0";
const TODO_ACTIVE_ICON_CLASS = "text-foreground";

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
  const activityState = STATUS_ACTIVITY_STATE[status];
  switch (status) {
    case "in_progress":
      return (
        <Icon
          name="Square"
          className={cn(className, TODO_ACTIVE_ICON_CLASS)}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <Icon
          name="Check"
          className={cn(className, activityIconClass(activityState))}
          aria-hidden="true"
        />
      );
    case "pending":
      return (
        <Icon
          name="Square"
          className={cn(className, activityIconClass(activityState))}
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
    <ul className="max-h-40 space-y-1 overflow-y-auto px-2.5 pb-2 pt-2">
      {ordered.map((item) => {
        const activityState = STATUS_ACTIVITY_STATE[item.status];
        const isActive = activityState === "active";
        return (
          <li
            key={item.id}
            className={activityRowClass(
              activityState,
              cn(
                "flex min-w-0 items-center gap-2 text-xs",
                isActive && TODO_ACTIVE_ROW_CLASS,
              ),
            )}
          >
            <TodoStatusIcon status={item.status} />
            <span
              className={activityTextClass(
                activityState,
                "min-w-0 flex-1 truncate",
              )}
              title={item.text}
            >
              {item.text}
            </span>
          </li>
        );
      })}
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
      <div className="flex items-center">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label={`To-do list: ${summary.aria}`}
          onClick={onToggle}
          className={TODO_HEADER_BUTTON_CLASS}
        >
          <Icon
            name="ListTodo"
            className={activityIconClass("active", "size-3.5 shrink-0")}
            aria-hidden="true"
          />
          <span
            className={activityTextClass(
              "active",
              "min-w-0 flex-1 truncate text-left",
            )}
          >
            {summary.visible}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              activityIconClass("active"),
              "size-3.5 shrink-0 transition-transform duration-200",
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
            : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden bg-popover">
          <TodoBody items={items} />
        </div>
      </section>
    </PromptStackCard>
  );
}
