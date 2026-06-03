import { CheckCheck, ListTodo } from "lucide-react";
import type { EmptyStateProps, TodoFilter } from "../types";

interface EmptyCopy {
  title: string;
  body: string;
}

function emptyCopy(filter: TodoFilter, hasTodos: boolean): EmptyCopy {
  if (filter === "done") {
    return {
      title: "Nothing finished yet",
      body: "Check off a task to see it land here.",
    };
  }
  if (filter === "open" && hasTodos) {
    return {
      title: "All caught up",
      body: "Every task is done. Add another to keep going.",
    };
  }
  return {
    title: "No todos yet",
    body: "Add one above, or write to todos/ with window.bb.data — it shows up here instantly.",
  };
}

export function EmptyState(props: EmptyStateProps) {
  const copy = emptyCopy(props.filter, props.hasTodos);
  const allClear = props.filter === "open" && props.hasTodos;

  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {allClear ? (
          <CheckCheck size={22} strokeWidth={2} />
        ) : (
          <ListTodo size={22} strokeWidth={2} />
        )}
      </span>
      <p className="empty-title">{copy.title}</p>
      <p className="empty-body">{copy.body}</p>
    </div>
  );
}
