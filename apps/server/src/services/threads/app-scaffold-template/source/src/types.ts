import type { ChangeEvent, FormEvent, MouseEvent } from "react";

export const TODO_DATA_PREFIX = "todos";

export interface TodoRecord {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TodoSnapshot {
  todos: TodoRecord[];
  invalidCount: number;
}

export type OperationStatus = "idle" | "saving" | "sending" | "sent" | "error";
export type TodoFilter = "all" | "open" | "done";

export type AddTodo = (title: string) => Promise<void>;
export type ToggleTodo = (id: string) => Promise<void>;
export type RemoveTodo = (id: string) => Promise<void>;
export type NotifyManager = () => Promise<void>;

export interface TodoStats {
  total: number;
  open: number;
  done: number;
}

export interface UseTodosResult {
  addTodo: AddTodo;
  errorMessage: string | null;
  invalidCount: number;
  isSdkAvailable: boolean;
  notifyManager: NotifyManager;
  operationStatus: OperationStatus;
  removeTodo: RemoveTodo;
  stats: TodoStats;
  todos: TodoRecord[];
  toggleTodo: ToggleTodo;
}

export interface TodoFormProps {
  disabled: boolean;
  onAdd: AddTodo;
}

export type TodoFormSubmitHandler = (event: FormEvent<HTMLFormElement>) => void;
export type TodoTitleChangeHandler = (
  event: ChangeEvent<HTMLInputElement>,
) => void;

export interface ProgressMeterProps {
  stats: TodoStats;
}

export interface TodoListProps {
  filter: TodoFilter;
  onRemove: RemoveTodo;
  onToggle: ToggleTodo;
  todos: TodoRecord[];
}

export interface EmptyStateProps {
  filter: TodoFilter;
  hasTodos: boolean;
}

export interface TodoRowProps {
  onRemove: RemoveTodo;
  onToggle: ToggleTodo;
  todo: TodoRecord;
}

export type TodoRowButtonHandler = (
  event: MouseEvent<HTMLButtonElement>,
) => void;

export interface FilterTabsProps {
  activeFilter: TodoFilter;
  onChange: SetTodoFilter;
  stats: TodoStats;
}

export type SetTodoFilter = (filter: TodoFilter) => void;

export interface DataNoticesProps {
  errorMessage: string | null;
  invalidCount: number;
}

export interface HeaderProps {
  appId: string;
  onNotifyManager: NotifyManager;
  operationStatus: OperationStatus;
}
