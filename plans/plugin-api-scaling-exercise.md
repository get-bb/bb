# Exercise: how far does the dispatch plugin API stretch?

The shipped API is deliberately minimal — every member has a consumer. This
doc pressure-tests that minimalism: for each future use case, what works
today, and what is the smallest addition when a real consumer arrives. All
pseudo-code.

## The API as shipped

Two namespaces, split by who is asking: **hooks are questions core asks and
acts on the answer to; events are announcements core makes, whose return
value is ignored.**

One hook — one checkpoint, three verdicts:

```ts
bb.experimental_hooks.on("message.dispatch", async (ctx) => {
  // ctx: thread, project, input {blocks, text},
  //      requestedExecution + executionSources,
  //      attempt: "start-turn" | "join-turn", queuedMessage | null,
  //      origin / originPluginId / parentThreadId / startedOnBehalfOf
  return { action: "proceed" };
  // or { action: "wait", reason: "why", sendAt?: epochMs }
  // or { action: "reject", message: "why not" }
});
```

A post-failure announcement, and one call that asks for another attempt:

```ts
bb.events.on("turn.failed", async (event) => {   // whatever it returns is ignored
  // event: threadId, requestId (the failed turn), turnId,
  //        errorInfo {category, providerCode, httpStatus},
  //        rateLimits (latest window), attemptNumber
  await bb.sdk.threads.retry({
    threadId: event.threadId,
    turnRequestId: event.requestId,
    sendAt: event.rateLimits.resetsAt,
    reason: "Rate limited",
  });
});
```

The retry is a by-reference row routed through the ordinary dispatch attempt:
a future `sendAt` makes it a `time` wait, an omitted one attempts it now, and
either way it runs the `message.dispatch` hook like any other send. Core
allows one live retry per original turn and computes `attemptNumber` from the
retry chain.

And one call that asks core to re-ask the question:

```ts
await bb.experimental_hooks.recheck();   // re-attempt every plugin-queued
                                              // row, in queue order, full pass
                                              // per row; resolves on SCHEDULE
```

Facts and signals:

```ts
await bb.sdk.threads.listRunning();      // [{id, hostId}] — EXACT inside a hook
                                          // (evaluation lock + flip-before-unlock),
                                          // snapshot anywhere else
bb.events.on("message.queued",     ({entry}) => …);  // a message queued with a wait
bb.events.on("message.dispatched", ({entry}) => …);  // a queued message went
```

Scheduling is data, not API: `sendAt` on any send/create (`--send-at`,
`composer.experimental_submit({ sendAt })`); core's due sweep re-attempts.

The three shipped consumers, whole:

```ts
// concurrency-limit: the entire policy
hooks.on("message.dispatch", async (ctx) => {
  if (ctx.attempt === "join-turn") return proceed;      // already holds its slot
  const running = await sdk.threads.listRunning();
  if (running.length >= max) return wait(`${max} of ${max} running`);
  return proceed;
});
// ...and its whole other half: capacity is ITS condition, so it watches for it
for (const e of ["thread.idle", "thread.failed",
                 "thread.archived", "thread.deleted"] as const)
  events.on(e, () => hooks.recheck());

// provider-retry: the entire policy
events.on("turn.failed", (e) => {
  if (!isRateLimit(e.errorInfo) || !e.rateLimits?.resetsAt) return;
  sdk.threads.retry({ threadId: e.threadId, turnRequestId: e.requestId,
    reason: "Rate limited", sendAt: e.rateLimits.resetsAt + jitter() });
});

// scheduled-send: no hook at all — a dialog that submits with sendAt
```

How a queued message wakes. **Core owns the re-draining and the clock;
plugins own every other wait condition and tell core when to re-ask.**

- Core-driven: `sendAt` due · the thread's own turn ending · workspace ready ·
  interaction settled · user Send-now · orphan sweep (owning plugin gone).
  Every one is queue mechanics or a core wait — a condition core is the only
  one that can see.
- Plugin-driven: `hooks.recheck()`, which schedules exactly the same walk.
  Capacity is the shipped example: core does not derive "a slot freed" at all
  any more, the limiter does.

## Future use cases

### Works today, zero additions

**Quiet hours / org pause / maintenance window** — a wait with a known end:

```ts
hooks.on("message.dispatch", () =>
  inQuietHours() ? wait("Quiet hours until 8:00", quietHoursEnd()) : proceed);
```

**Budget caps on provider windows** — own accounting + wait until window end:

```ts
bb.events.on("message.dispatched", track);
hooks.on("message.dispatch", () =>
  spentThisWindow() > cap ? wait("Budget cap hit", windowEnd()) : proceed);
```

**Dependency ordering ("run after thread X") / CI-aware dispatch** — the hook
states the condition, and whatever can observe it wakes core:

```ts
hooks.on("message.dispatch", async (ctx) => {
  const blocker = blockerFor(ctx.thread);
  if (blocker && !(await isDone(blocker)))
    return wait(`After ${blocker.title}`);
  return proceed;
});

// "run after thread X" is observable — no poll needed
bb.events.on("thread.idle", () => hooks.recheck());
// a CI webhook is too
bb.http.route("POST", "ci-done", async () => {
  await hooks.recheck();
  return Response.json({ ok: true });
});
```

Polling through the hook — `wait(reason, now() + 30_000)` and re-check on the
re-attempt — remains the *designed* fallback for a condition nothing in the
plugin can observe. Latency = poll interval. `recheck()` is the wake for
everything else, and it has no latency floor.

### Needs addition #1: amendments (`proceed` gains `amend`)

For **modifying dispatch parameters** — org model policy, DLP/prompt
rewriting, auto model selection:

```ts
hooks.on("message.dispatch", (ctx) => {
  if (ctx.executionSources.model !== "explicit")
    return proceed({ amend: { model: orgDefaultModel } });
  return proceed;
});

// DLP: input amendment is legal even on join-turn (steers) — the one
// amendment that never conflicts with a running turn
hooks.on("message.dispatch", (ctx) =>
  proceed({ amend: { input: redact(ctx.input.blocks) } }));
```

This exact machinery shipped and was cut when its consumer (auto routing)
died: verdict schema, per-field validation windows (`join-turn` → input
only; provider only before the first session), provenance
(never-remembered-as-defaults), and the original-vs-effective audit. It
returns from git history as a unit. The one open design each revival must
re-decide: whether amendments compose across the handlers in a pass (they did
— last writer per field, which forces per-handler context rebuilds and
ordering questions).

### Shipped instead of addition #2: `recheck()` — external events

This was "needs addition #2: plugin-initiated wake (`clearWait`)". It is no
longer an addition, and it is not `clearWait`. **Plugin-initiated wake ships
as `bb.experimental_hooks.recheck()`**, and the external-event half of
the sandbox case works today:

```ts
hooks.on("message.dispatch", (ctx) => {
  if (!wantsSandbox(ctx)) return proceed;
  startProvisioning(ctx);                                      // background
  return wait("Provisioning sandbox…");                        // no sendAt
});

// background service, minutes later:
await createVm().then(enrollViaJoinCode);                      // existing SDK
await bb.experimental_hooks.recheck();  // re-ask; the handler above now
                                             // proceeds, and the limiter and
                                             // every other handler still apply
```

**`clearWait` is retired, not deferred.** It named a row and released it, which
made ownership the authorization model and forced a plugin to correlate rows it
had queued. `recheck` names nothing: it asks core to re-run the full pass
over every plugin-queued row, and the handler that queued a row is the thing
that decides whether it still should be queued. Re-ask-not-send and
refuse-before-settle — the two properties `clearWait` was valued for — come
free, because the only way a row moves is a handler answering `proceed` again.
The correlation problem, the ownership check, and "a stale release safely
re-queues" all stop being design questions.

What the sandbox still needs is the OTHER half: **`amend.environment`** (see
addition #1) to land the thread on the host it just created. That one remains
hypothetical. `report()` (progress steps + ETA on the queue row) is likewise
still cut and still recoverable from history.

### Needs addition #3: new wait kinds / wake sources (core-side, additive)

Some futures are core facts, not plugin powers: warm worktree pools
(`environment.destroy` interception), a `host-offline`-style wait for a new
condition, new drain triggers. Each is an added arm on `waitingOn` plus a
drain hook — the schema and drain structure were built to take new arms
without touching existing ones.

## The pattern

The API scales on exactly three axes, and every use case above lands on one:

| Axis | Mechanism | Cost when needed |
|---|---|---|
| New *policies* | compose `wait`/`proceed`/`reject` + sdk facts + `recheck` wakes + `sendAt` polling | zero — write a plugin |
| New *powers* | `amend` on proceed; `report` for progress on the row | revive from history against the real consumer |
| New *conditions* | `waitingOn` arms + core-owned drain triggers | additive core change |

The bet, stated plainly: everything cut was cut *because* it re-adds
cleanly. The verdict union extends without breaking handlers; queue rows
carry new wait kinds without schema surgery; and the fallback
(sendAt polling) means no use case is ever *impossible* before its
addition lands — only slower. `recheck` is the first draw on that bet
and it came back cheap: one member, no row ids, no ownership model, and the
core signal it replaced deleted outright.
