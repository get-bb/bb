---
name: add-todos
description: Add todos to this bb Todo app by writing per-item app data records.
---

# Add Todos

Use this skill when you need to add todos to this app from an agent or script.
The app listens to app data changes under `todos/`, so records written out of
band appear in the UI through the live `window.bb.data.onChange` binding.

## Record format

Write one JSON record per todo at:

```text
todos/<id>
```

The `<id>` must match the record's `id` field and must be a valid app data path
segment. Use a stable lowercase id such as `todo_20260603_review_notes`.

```json
{
  "id": "todo_20260603_review_notes",
  "title": "Review notes from the manager",
  "done": false,
  "createdAt": "2026-06-03T20:00:00.000Z",
  "updatedAt": "2026-06-03T20:00:00.000Z"
}
```

Required fields: `id`, `title`, `done`, `createdAt`, `updatedAt`.
Use ISO 8601 timestamps. Do not store todos in `state.json`; the app binds to
per-item records under `todos/`.

## CLI write

```bash
application_id="<applicationId>"
todo_id="todo_20260603_review_notes"
created_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
json="{\"id\":\"$todo_id\",\"title\":\"Review notes from the manager\",\"done\":false,\"createdAt\":\"$created_at\",\"updatedAt\":\"$created_at\"}"
printf '%s\n' "$json" | bb app data write "$application_id" "todos/$todo_id" --stdin
```

## In-app write

```ts
await window.bb.data.write({
  path: `todos/${id}`,
  value: {
    id,
    title,
    done: false,
    createdAt,
    updatedAt: createdAt,
  },
});
```
