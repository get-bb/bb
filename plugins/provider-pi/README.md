# Pi provider

First-party plugin for the [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
Pi is user-installed (`npm install -g @earendil-works/pi-coding-agent`, 0.84.0
or newer); the plugin ships no agent tree.

What lives here:

- `server.ts` — the plugin's runtime: one `bb.providers.register` for `pi`
  (`src/declaration.ts`).
- `src/host.ts` — the `bb.host` artifact, two surfaces in one file: the
  provider bridge (`src/bridge/`, a thin bridge over `pi --mode rpc` plus the
  bb extension pi loads) and the host entry that answers `resolveNativeRoots`
  (`src/native-roots.ts`).
- `src/delta-translation.ts` — pi's session events become bb's thread deltas.
- `src/bridge/provider-maintenance.ts` — the install gate (`pi --version`
  ≥ 0.84.0) and the npm install/update actions.
- `src/bridge/extension-ui.ts` — pi extension dialogs reach the user:
  `ctx.ui.select/confirm/input/editor` inside a pi extension arrive as pi RPC
  `extension_ui_request` lines, the bridge forwards each dialog as a
  `provider-pi/extension-ui` interaction request, and the plugin's pending
  interaction renderer (`app.tsx`) shows it and returns the answer to pi.
  Fire-and-forget requests (`notify`, `setStatus`, `setWidget`, `setTitle`,
  `set_editor_text`) are accepted and dropped. A dialog left pending when the
  session closes is answered cancelled. Requests that fail validation are
  answered cancelled, never forwarded. Select answers must match an offered
  option. Helper sessions without a dialog handler automatically cancel dialogs
  so extensions cannot block helper startup waiting for user input.

## Skills

Pi's skill layout is the plugin's fact, so bb lists pi's skills beside its
own and core holds no pi policy. The registration declares the documented
directories (`experimental_nativeSkillRoots`):

- `user`: `.pi/agent/skills` and `.agents/skills` under the host's home.
- `project`: `.pi/skills` and `.agents/skills` under the workspace.

The directories only a host knows are the host entry's answer
(`experimental_resolvesNativeRoots`): when bb lists skills on a host it asks
the plugin's host entry there, which reads `<agentDir>/settings.json`'s
`skills` entries (absolute, `~`-relative, or relative to the agent dir) and
adds `<agentDir>/skills` when `PI_CODING_AGENT_DIR` moves the agent dir. Each
host answers for itself, from its own files, at listing time (bb caches the
answer briefly). A settings entry that names a declared directory is listed
once: bb scans each directory once, and the declared root wins.

Not listed, by design:

- Skills pi loads through `packages` (npm/git installs pi manages itself) and
  `!pattern` disable entries: pi still applies them, bb does not show them.
- A settings entry naming a single `.md` file (`SKILL.md` or any other
  markdown file pi loads as one skill): it has no directory root to scan.
- The trusted project's `.pi/settings.json` `skills` entries: the host entry
  reads the user settings only.
- `.agents/skills` in ancestor directories of the workspace (pi walks up to
  the git root): the declared `project` roots resolve against the workspace
  only.

## Environment

`BB_PI_BRIDGE_COMMAND` and `BB_PI_BRIDGE_ARGS` point the bridge (and its
version probe) at a pi executable other than the `pi` on `PATH` — a pinned
install in a temporary prefix, say. The plugin declares them as environment
passthrough, so a value set on the host daemon's environment reaches the
bridge process; bb strips every other inherited `BB_*` variable.

## Experimental background task events (v1)

Third-party Pi extensions can publish native BB background task cards and active
counters through the provider-owned `pi.events` contract. This works for Pi
threads started through BB's UI, SDK, or CLI; no new tool or core SDK API is
required. It is experimental and is not a Pi upstream API guarantee.

Emit on `bb:background-task` with:

- `v: 1`, `source`: stable extension namespace, `sourceId`: unique publisher
  lifetime ID (use a fresh UUID after reload), `sequence`: strictly increasing
  positive safe integer within that lifetime.
- `kind: "upsert"` and `task`, `kind: "snapshot"` and `tasks`, or `kind: "clear"`.
- Each task has `id` (unique run ID, never reused within a lifetime), `label`,
  `taskType` (`local_subagent`, `local_agent`, or `local_bash`), and `status`
  (`pending`, `running`, `paused`, `completed`, `failed`, `killed`, or `stopped`).
  Optional `summary` and `error` are short, user-visible text, not raw output.

Identifiers are 1–128 characters and exclude control characters and `|` (the
internal separator). Labels are 1–256 characters; summary/error are at most
2048 characters each. Snapshots contain at most 256 unique task IDs. Malformed
and unsupported-version events, including duplicate snapshot IDs, are rejected
atomically. Extra fields are stripped: no prompts, output, arbitrary payloads,
thread IDs, or arbitrary task types are accepted. Do not put secrets into labels,
summaries, or errors. The injected extension forwards only this envelope over
FD3, never stdout RPC or model messages; serialized envelopes over 2 MiB are dropped.

```ts
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const sourceId = randomUUID();
  let sequence = 0;
  const tasks = new Map();
  const publish = (fields: object) =>
    pi.events.emit("bb:background-task", {
      v: 1,
      source: "example.worker",
      sourceId,
      sequence: ++sequence,
      ...fields,
    });
  const unsubscribe = pi.events.on("bb:background-task:request", () => {
    publish({ kind: "snapshot", tasks: [...tasks.values()] });
  });
  pi.on("session_shutdown", unsubscribe);
  pi.registerCommand("example-background-card", {
    handler: async () => {
      const task = {
        id: randomUUID(),
        label: "Example completed work",
        taskType: "local_subagent",
        status: "completed",
      };
      tasks.set(task.id, task);
      publish({ kind: "upsert", task });
    },
  });
}
```

Maintain your own bounded current task registry and update it before publishing.
The bridge emits `bb:background-task:request` with `{ v: 1 }` after a real thread
session binds/resets or is successfully replaced. Respond with a fresh sequence
and a complete snapshot for your namespace, including any unfinished tasks.
Helpers for model discovery and forking do not request snapshots or publish cards.
Events received before the first real agent turn are held until `agent_start`;
telemetry never fabricates a turn or triggers a model call. Cards are displayed in
the transcript (`skipTranscript: false`) and eligible for native active counts;
this presentation flag does not inject telemetry into MODEL context or prompts.

Cards open once with source/lifetime/session/observer-epoch-namespaced identities. Pending,
running, and paused remain active; completed/failed close with that outcome;
killed/stopped close as interrupted. Progress and completion continue after the
parent turn settles. Terminal run IDs cannot reopen, and stale sequence numbers
and retired publisher lifetimes are ignored. A new lifetime reconciles the old
publisher's active tasks. Snapshot omissions and clear close active observed cards
as stopped. Session stop, exit/crash, or successful replacement also reconcile
cards; a failed replacement preserves the old observer.

State is bounded per session: 64 source namespaces, 32 retired lifetime IDs per
source, and 2048 admitted run IDs total across lifetimes. At capacity, new work or
new lifetimes are rejected atomically rather than silently evicting active work;
updates to admitted tasks remain accepted. A fresh session or observer epoch resets
these budgets.

This is observation only: reconciliation does not kill third-party processes.
The provider does not own or cancel tasks, collect output, create threads, or
schedule model continuations. Existing stop behavior still terminates the Pi
process. Extensions remain responsible for work lifecycle and cleanup. The
injected listener unsubscribes on session shutdown/reload, closes active observations
as stopped, and rejects late events until ready. On ready it requests fresh snapshots:
returning sources open cards in a new observer epoch, while absent sources stay
stopped. Recovery can use the current/last real turn without a synthetic turn or
model prompt, even when a publisher retains its lifetime and run IDs. Process exit
and close reconcile idempotently. The listener tolerates runtimes without `pi.events`.

## Tests

The bridge tests drive `src/bridge/fake-pi-rpc.mjs`, a scripted
`pi --mode rpc` that loads the real bb extension the way pi does and speaks
pi's framing (LF-delimited JSON, raw U+2028 and U+2029). Its prompts script a
turn: `/tool <name> <json>` runs an extension tool, `/hold` keeps the run open
until `abort` or a steer, `/fail-run` ends it with an assistant error, `/ui
<json>` opens an extension dialog, and `/die` exits mid-run. `FAKE_PI_*`
environment variables select the rest: the reported version (`crash` for a
broken install), logs of spawns, commands, prompts, and tools, and the faults
the lifecycle and steering tests inject.

`bridge.bun-runtime.test.ts` runs the same fake under Bun when it is
installed: pi ships as a Bun standalone binary, and Bun's `node:net` could not
attach a read handle to a borrowed stdio fd, which silently dropped every
dynamic tool result.

The recorded-conformance replay of bb's committed pi recordings
(`packages/provider-bridge-protocol/recordings/pi`) runs in
`@bb/provider-parity` (`pi-recorded-conformance.test.ts`), because the
recordings live outside the plugin.
