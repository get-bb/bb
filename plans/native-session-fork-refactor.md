# Native provider session fork for thread fork + side chat

## Why

The current PR seeds fork + side chat with a **text-snapshot replay** (a bounded 10/6-message window
of the *visible* transcript, prepended as an `agent-only` prompt to a brand-new provider session).
That loses tool results, reasoning, prompt cache, and anything outside the window. **All three
providers natively fork sessions**, and bb already tracks a provider session id per thread
(`providerThreadId`) and a provider message id per message — so we can replace the snapshot with a
true session branch.

## Decisions (resolved)

- **A. Rework THIS PR to native fork before merge.** Thread model, env resolver, send-to-main, and
  composer UI stay; only the *seed* changes.
- **B. Defer to native fork at head** — no custom up-to-message logic. Fork branches the whole
  current session; the per-message anchor becomes a UI/reply reference, not a context window.
- **C. All three providers (claude-code, codex, pi) land in this PR.**
- **D. No snapshot fallback.** Delete `conversation-context-snapshot`. Gate Fork / Open-side-chat on
  a **forkable parent session** (same host + a live `providerThreadId`); no session → affordance
  disabled.

## How side chats change

Still a separate read-only thread with send-to-main — only the seed changes:
- **Full history via native fork at head** (tool results, reasoning, cache) — no digest.
- **"From this message" = a reply, not a window.** If the anchor **is** the last message → nothing
  extra. If it's **not** the last message → the anchored message is (a) shown in the side-chat UI as
  the message being replied to, and (b) sent to the agent as context with the user's first message.
  Effect: "reply to an earlier message, full thread attached." (`tab.sourceMessageText` already
  carries the anchored text; "is last?" is a timeline check at open.)
- **Isolated copy** (new `providerThreadId`); readonly + send-to-main unchanged.

## Native capability matrix (verified)

| Provider | resume | native fork | session id | evidence |
|---|---|---|---|---|
| claude-code `@anthropic-ai/claude-agent-sdk@0.3.162` | ✅ | ✅ `forkSession(id,{dir})` → `{sessionId}` synchronously | `session_id` | `sdk.d.ts:675`, `.mjs` impl |
| codex `codex-cli 0.139.0` | ✅ | ✅ JSON-RPC `thread/fork` (`ThreadForkParams.threadId`) → `Thread{id,forkedFromId}` | rollout UUID | `ClientRequest.ts:107`, `ThreadForkParams.ts` |
| pi `@mariozechner/pi-coding-agent@0.70.5` | ✅ | ✅ `SessionManager.forkFrom()` / `createBranchedSession()` (not yet wired) | bb threadId (file path) | `session-manager.d.ts:319` |

## Phase 0 findings — verified wiring map

**Per provider:**
- **claude-code (clean):** standalone `forkSession(sourceProviderThreadId,{dir:cwd})` reads the
  source `.jsonl`, copies the full transcript with fresh UUIDs, returns `{sessionId}` synchronously.
  New surface: one zod command in `claude-code/bridge/commands.ts`, one `handleThreadFork` in
  `bridge.ts` (mirror `handleThreadResume` but await `forkSession()`, emit identity eagerly like
  `handleThreadStart`, then `session.start(forkedId)` via the unchanged resume path), one
  `buildCommandPlan` case + `translateAcceptedCommand` arm in `adapter.ts`. Same-host (reads local
  disk); fork at head when source idle; pass `dir:cwd`.
- **codex (clean):** native `thread/fork` RPC; new id flows through existing
  `codex/event-translation.ts` `thread/started`→`thread/identity`. One `buildCommandPlan` case
  (`codex/adapter.ts:~1388`), extend `translateAcceptedCommand` git-roots guard. Use `threadId`
  (the `path` field is `[UNSTABLE]`); `persistExtendedHistory:false`; no `dynamicTools` at fork.
- **pi (extra wiring):** pi identity == bb threadId (deterministic file path), not a provider id.
  Add a source pointer to the start/fork command + bridge schema, call `forkFrom()` /
  `createBranchedSession()`, write the forked file at the new bb thread's deterministic path (or via
  the existing resume `sessionPath`), keep echoing the bb threadId as identity.

**Plumbing (insertion points confirmed):**

| Layer | File | Add |
|---|---|---|
| Adapter command | `agent-runtime/src/provider-adapter.ts` (after `thread/resume`) | `thread/fork` `AdapterCommand` + `ProviderCapabilities.supportsFork` |
| Runtime args | `agent-runtime/src/types.ts` `StartThreadArgs` | `fork?: { sourceProviderThreadId }` |
| Runtime dispatch | `agent-runtime/src/runtime.ts` `startThread` (~794) | when `args.fork` → build `thread/fork` cmd; reuse identity/turn tail |
| Daemon contract | `host-daemon-contract/src/commands.ts` `threadStartCommandSchema` (strict) | `fork: z.object({ sourceProviderThreadId }).optional()` |
| Daemon handler | `apps/host-daemon/src/command-handlers/thread.ts` | pass `command.fork` into `runtime.startThread` |
| Provision payload | `server/.../thread-provisioning-context.ts` `threadProvisionCommonPayloadSchema` | `fork` field (thread through context constructors) |
| Server policy | `server/.../thread-provisioning.ts` `startThreadIfEnvironmentReady` (seedWithoutRun branch) | fork + parent-forkable + same-host → issue fork **eagerly** instead of the lazy idle short-circuit |
| Parent session id | `getLastProviderThreadId(deps, parentThread.id)` (`thread-events.ts:928`) | already exists — no new query |

**Key behavior change:** forks must provision **eagerly** at create time (clone the parent at the
branch point), not lazily. `seedWithoutRun` then = "fork established, no first turn" (runtime already
encodes *no input → no turn*); a side chat passes the question as input and runs against the fork.

## Phasing (all in this PR, current branch)

- **Phase 1 — spine + codex:** `thread/fork` AdapterCommand + `supportsFork` capability +
  `StartThreadArgs.fork` + runtime dispatch + daemon contract/handler + **codex** adapter case
  (claude/pi `buildCommandPlan` noop for now). Keep agent-runtime + host-daemon-contract + host-daemon
  typecheck green.
- **Phase 2 — server policy:** provision payload `fork` field + `startThreadIfEnvironmentReady`
  issues the fork eagerly when the child has a forkable same-host parent session. Gate the
  Fork/Open-side-chat affordances on a forkable parent.
- **Phase 3 — claude-code adapter:** `forkSession()` bridge handler + adapter case.
- **Phase 4 — pi adapter:** `forkFrom`/`createBranchedSession` + bridge schema source pointer.
- **Phase 5 — side chats (app):** native fork seed + anchored-message reply reference (UI +
  first-turn context when anchor isn't head); readonly + send-to-main unchanged.
- **Phase 6 — delete the snapshot path:** remove `conversation-context-snapshot` + the text-seed
  code; update tests/stories.

## Risks / notes

- **Host locality:** fork needs the parent's session files on the same host; bb already co-locates
  the child env on the source's host. Cross-host = not forkable (gated).
- **Forkable-session gating:** a thread that never ran (or whose session was reaped) isn't forkable.
- **Workspace divergence:** the forked session's tool history references the parent's workspace
  paths; the fork runs in a fresh same-branch worktree, so paths align structurally.
- **Read-only reach:** going-forward reach is bb's `permissionMode` (unchanged); confirm the fork
  doesn't implicitly carry write capability.

## Exit criteria

- A forked thread's first turn sees the parent's real state (tool results/reasoning), with a new
  `providerThreadId` distinct from the parent's.
- Fork / Open-side-chat gated on a forkable same-host session; `conversation-context-snapshot` is
  gone (no references remain).
- Side chat from a non-last message renders the anchored reply reference + includes it in the first
  turn; from the last message it does not.
- Per-adapter tests (mock the fork RPC; assert `thread/fork` issues with the right source id + a
  fresh identity). Smoke-test fork + side chat on all three providers.
