import type {
  ThreadTimelinePendingTodoItem,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const PLAN_CARD_ROW_HEIGHT = 32;
const BODY_ID = "thread-plan-card-body";
const TOGGLE_ID = "thread-plan-card-toggle";

const STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

export function hasActivePlanItems(plan: ThreadTimelinePendingTodos): boolean {
  return plan.items.some((item) => item.status !== "completed");
}

function planTitle(items: readonly ThreadTimelinePendingTodoItem[]): string {
  return (
    items.find((item) => item.status === "in_progress")?.text ??
    items.find((item) => item.status === "pending")?.text ??
    items[0]?.text ??
    "Plan"
  );
}

function completedCount(items: readonly ThreadTimelinePendingTodoItem[]): number {
  return items.filter((item) => item.status === "completed").length;
}

function PlanActiveBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs leading-none text-success">
      <span className="size-1.5 shrink-0 rounded-full bg-success" />
      Active
    </span>
  );
}

function PlanStatusIcon({
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
          className={cn(className, "fill-current text-muted-foreground/35")}
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

function orderedPlanItems(
  items: readonly ThreadTimelinePendingTodoItem[],
): ThreadTimelinePendingTodoItem[] {
  return [...items].sort(
    (a, b) => STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status],
  );
}

export interface ThreadPlanCardProps {
  plan: ThreadTimelinePendingTodos | null;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ThreadPlanCard({
  plan,
  isExpanded,
  onToggle,
}: ThreadPlanCardProps) {
  if (!plan || plan.items.length === 0 || !hasActivePlanItems(plan)) {
    return null;
  }
  const items = orderedPlanItems(plan.items);
  const title = planTitle(items);
  const done = completedCount(items);

  return (
    <PromptStackCard
      ariaLabel="Plan"
      className="overflow-hidden"
      style={{ minHeight: PLAN_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          id={TOGGLE_ID}
          aria-expanded={isExpanded}
          aria-controls={BODY_ID}
          aria-label={`Plan: ${title}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-xs text-foreground transition-colors hover:bg-state-hover"
        >
          <Icon
            name="ListTodo"
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-left" title={title}>
            {title}
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
        <PlanActiveBadge />
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
          <div className="space-y-2 px-3 pb-2.5 pt-2">
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 items-start gap-2 text-xs leading-relaxed"
                >
                  <span className="pt-0.5">
                    <PlanStatusIcon status={item.status} />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-words",
                      item.status === "in_progress" &&
                        "font-medium text-foreground",
                      item.status === "pending" && "text-muted-foreground",
                      item.status === "completed" &&
                        "text-subtle-foreground line-through decoration-subtle-foreground",
                    )}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  name="ListTodo"
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {items.length} {items.length === 1 ? "step" : "steps"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  name="Check"
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                {done}/{items.length} complete
              </span>
            </div>
          </div>
        </div>
      </section>
    </PromptStackCard>
  );
}
