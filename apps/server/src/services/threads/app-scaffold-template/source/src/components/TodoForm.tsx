import { useState } from "react";
import { Plus } from "lucide-react";
import type {
  TodoFormProps,
  TodoFormSubmitHandler,
  TodoTitleChangeHandler,
} from "../types";

export function TodoForm(props: TodoFormProps) {
  const [title, setTitle] = useState("");
  const canSubmit = !props.disabled && title.trim().length > 0;

  const handleChange: TodoTitleChangeHandler = (event) => {
    setTitle(event.currentTarget.value);
  };

  const handleSubmit: TodoFormSubmitHandler = (event) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      return;
    }
    void props.onAdd(trimmedTitle);
    setTitle("");
  };

  return (
    <form className="todo-form" onSubmit={handleSubmit}>
      <div className="todo-input-wrap">
        <Plus
          className="todo-input-icon"
          size={16}
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          id="todo-title"
          className="todo-input"
          aria-label="New todo"
          value={title}
          onChange={handleChange}
          disabled={props.disabled}
          placeholder="Add a task and press Enter"
        />
      </div>
      <button className="primary-button" type="submit" disabled={!canSubmit}>
        Add
      </button>
    </form>
  );
}
