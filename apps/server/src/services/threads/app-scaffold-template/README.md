# BB_APP_NAME_PLACEHOLDER

A Vite, React, and TypeScript Todo app scaffold for bb apps. It stores each
todo as its own app data record, subscribes to live data changes, and can send a
message back to the thread that opened it.

## Layout

```text
manifest.json
README.md
public/                 # Served by bb as the app web root
skills/add-todos/        # Agent skill for out-of-band todo writes
source/                  # Editable Vite + React + TypeScript app
```

App data lives outside this folder at `<dataDir>/app-data/<applicationId>/`,
created on first write.

Only `public/` is served to the browser. The committed `public/` build lets a
new app render immediately after `bb app new`.

## Install And Build

From this app directory:

```bash
cd source
pnpm install
pnpm build
```

`pnpm build` typechecks with `tsc --noEmit`, then runs Vite and emits the
browser build to `../public` with a relative base (`"./"`),
`build.outDir: "../public"`, and `build.assetsDir: ""`. That keeps asset
references flat and relative so bb can serve them from the app route.

## Development

Use `source/` for edits:

```bash
cd source
pnpm dev
```

The dev server is only for local editing. bb serves the prebuilt files in
`public/`, so rebuild after editing `source/`.

## App Data

Todos are per-item records:

```text
todos/<id>
```

```json
{
  "id": "todo_example",
  "title": "Write the first todo",
  "done": false,
  "createdAt": "2026-06-03T20:00:00.000Z",
  "updatedAt": "2026-06-03T20:00:00.000Z"
}
```

The app subscribes with `window.bb.data.onChange({ prefix: "todos", callback })`
— the SDK replays existing records to every new subscriber, so the
subscription also hydrates initial state — and resets its state on
`window.bb.on({ event: "app-data:resync", callback })` before the SDK
re-replays records. It writes with `window.bb.data.write({ path, value })`,
deletes with `window.bb.data.delete({ path })`, and sends thread updates with
`window.bb.message.send({ payload })`.

The vendored SDK declaration at `source/src/bb-sdk.d.ts` mirrors the current
`@bb/sdk` injected app runtime. Keep it in sync when the SDK contract changes.
