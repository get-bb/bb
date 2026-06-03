import type { TodoFilter, TodoListProps, TodoRecord } from "../types";
import { EmptyState } from "./EmptyState";
import { TodoRow } from "./TodoRow";

interface FilterTodoArgs {
  filter: TodoFilter;
  todo: TodoRecord;
}

function isVisibleTodo(args: FilterTodoArgs): boolean {
  if (args.filter === "open") {
    return !args.todo.done;
  }
  if (args.filter === "done") {
    return args.todo.done;
  }
  return true;
}

export function TodoList(props: TodoListProps) {
  const visibleTodos = props.todos.filter((todo) =>
    isVisibleTodo({ todo, filter: props.filter }),
  );

  if (visibleTodos.length === 0) {
    return (
      <EmptyState filter={props.filter} hasTodos={props.todos.length > 0} />
    );
  }

  return (
    <ul className="todo-list">
      {visibleTodos.map((todo) => (
        <TodoRow
          key={todo.id}
          todo={todo}
          onToggle={props.onToggle}
          onRemove={props.onRemove}
        />
      ))}
    </ul>
  );
}
