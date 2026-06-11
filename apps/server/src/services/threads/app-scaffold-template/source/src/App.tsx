import { useMemo, useState } from "react";
import { DataNotices } from "./components/DataNotices";
import { FilterTabs } from "./components/FilterTabs";
import { Header } from "./components/Header";
import { ProgressMeter } from "./components/ProgressMeter";
import { TodoForm } from "./components/TodoForm";
import { TodoList } from "./components/TodoList";
import { useTodos } from "./useTodos";
import type { TodoFilter } from "./types";

function currentAppId(): string {
  return window.bb?.applicationId ?? "local preview";
}

export function App() {
  const [filter, setFilter] = useState<TodoFilter>("all");
  const appId = useMemo(currentAppId, []);
  const todos = useTodos();
  const formDisabled =
    !todos.isSdkAvailable || todos.operationStatus === "saving";

  return (
    <main className="app-shell">
      <Header
        appId={appId}
        onSendStatusUpdate={todos.sendStatusUpdate}
        operationStatus={todos.operationStatus}
      />

      <section className="todo-card">
        <TodoForm disabled={formDisabled} onAdd={todos.addTodo} />
        <div className="todo-toolbar">
          <FilterTabs
            activeFilter={filter}
            onChange={setFilter}
            stats={todos.stats}
          />
          <ProgressMeter stats={todos.stats} />
        </div>
        <TodoList
          filter={filter}
          todos={todos.todos}
          onToggle={todos.toggleTodo}
          onRemove={todos.removeTodo}
        />
      </section>

      <DataNotices
        errorMessage={todos.errorMessage}
        invalidCount={todos.invalidCount}
      />
    </main>
  );
}
