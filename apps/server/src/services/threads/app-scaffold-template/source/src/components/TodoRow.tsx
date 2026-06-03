import { Check, Trash2 } from "lucide-react";
import type { TodoRowButtonHandler, TodoRowProps } from "../types";

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TodoRow(props: TodoRowProps) {
  const toggleLabel = props.todo.done ? "Mark as open" : "Mark as done";
  const handleToggle: TodoRowButtonHandler = () => {
    void props.onToggle(props.todo.id);
  };
  const handleRemove: TodoRowButtonHandler = () => {
    void props.onRemove(props.todo.id);
  };

  return (
    <li className="todo-row" data-done={props.todo.done}>
      <button
        className="todo-check"
        type="button"
        aria-pressed={props.todo.done}
        aria-label={toggleLabel}
        onClick={handleToggle}
      >
        <Check size={14} strokeWidth={3} aria-hidden="true" />
      </button>
      <div className="todo-content">
        <span className="todo-title">{props.todo.title}</span>
        <span className="todo-meta">
          <code>todos/{props.todo.id}</code>
          <span className="todo-dot" aria-hidden="true" />
          {formatTimestamp(props.todo.updatedAt)}
        </span>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="Remove todo"
        onClick={handleRemove}
      >
        <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}
