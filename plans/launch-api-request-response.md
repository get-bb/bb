# Addressing the Discord launch-API requests

Source: https://gist.github.com/hemaaanth/e7facb84ab768043aa3c27dfdd5cdc5a —
six requests around thread creation, plugin launch integration, and async
environment provisioning (a sandbox-provider author).

This is the event our doctrine waited for: a real external consumer. The
ledger below maps each request to what the queue-rework branch already
ships, what was designed-and-cut and now has its revival trigger, and what
is genuinely new. Notation: **SHIPPED** / **REVIVE** (returns from git
history against this consumer) / **NEW** (needs design) / **PUSH BACK**.

## 1. Two-phase thread creation (`createPending` → attach env → `start`)

**SHIPPED, under different names.** The canonical `pending` status is
two-phase creation: a thread row exists with nothing dispatched; the first
message's dispatch attempt is "start". The sandbox flow they describe:

```ts
hooks.on("message.dispatch", (ctx) => {
  if (!isSandboxLaunch(ctx)) return proceed;
  beginProvisioning(ctx);                      // async, minutes
  return wait("Provisioning sandbox…");        // thread stays pending, visibly
});
// later: provisioning done → attach → hooks.recheck("message.dispatch")
```

**Gap (REVIVE):** the "attach environment" step. Waking core is shipped
(`recheck`); *carrying the provisioned environment into the attempt* is the
cut `amend.environment` — the wake must be able to say "and run it here."
Two revival shapes, decide with the consumer:
- amendments on `proceed` (the general cut machinery), or
- independent environments (`sdk.environments.create` + the thread's
  existing `reuse` attachment) so the hook's re-attempt finds the
  environment already core-owned — see `plans/` env-independence
  discussion; this is also their request 2's answer.

## 2. Plugin environment resolvers returning core-owned environments

**REVIVE, in the shape we already chose over registries.** They explicitly
do NOT want to inject arbitrary environment values — they want the result
to be a core-owned environment. That is exactly the conclusion our two
provisioner-registry designs converged on before being cut. The modern
answer is **environments as a first-class noun**:

```ts
const env = await sdk.environments.create({ projectId, host, workspace });
// core provisions it through the existing pipeline; core owns it forever
// threads attach via the existing { type: "reuse", environmentId }
```

This serves every launch surface uniformly (native composer, automations,
workflows, task launchers) because they all end at the same dispatch
attempt. The open design is ownership/reclamation of unattached
environments (owner attribution, retention, orphans-flagged-never-destroyed)
— the one hard problem, already scoped in discussion. A resolver
*registration* model stays declined unless `create`+`reuse` proves
insufficient: registries add an ownership concept the noun-based shape
avoids.

## 3. `launchId` + namespaced envelope + multi-plugin roles

**Half REVIVE, half PUSH BACK.**
- The namespaced envelope is the cut `pluginInputs`
  (`Record<pluginId, JsonValue>` riding create/send, delivered only to the
  owning plugin's hook, persisted on the queued row). It was cut with its
  last consumer; this author is its new one. Revives as a unit.
- `launchId`: likely unnecessary — the thread id exists from creation
  (`pending`), before anything runs, and is durable. Their "split state"
  worry dissolves when creation is cheap and immediate: create pending,
  record associations against the real id, then dispatch. If a pre-thread
  correlation id is still wanted for multi-surface drafts, that belongs to
  request 6, not the launch path.
- The role system (preset/environment/association/finalize/cleanup):
  **push back.** Roles are a pipeline framework; our grammar covers each
  role with an existing primitive — preset → `pluginInputs` + hook;
  environment → request 2; association → plugin kv keyed by thread id;
  finalize → `thread.created`/`message.dispatched` events; cleanup →
  `thread.archived`/`deleted` events (+ `environment.destroyed` when
  request 2 lands). Offer the mapping, not the framework. If real
  coordination gaps remain after the mapping, they will be specific and
  small.

## 4. Plugins lock composer fields, with visible reasons

**Two layers; recommend shipping the enforcement layer first.**
- Enforcement = the cut **amendments + provenance** machinery (validated
  per-field amendment windows; "chosen by <plugin>" recorded on the turn;
  never remembered as user defaults). Revives as a unit; this author is
  consumer #2 (after DLP-style policy) for it.
- UI locking (fields disabled pre-submission with a reason) is **NEW**
  composer surface — a constraints registration
  (`composer.experimental_constrain({ field, value, reason })`-shaped).
  Legitimate, but it is sugar over enforcement: without amendments, a lock
  is a lie the server won't back. Sequence: amendments → then constraints
  as the honest UI of an enforced amendment.

## 5. Native preflight + launch-progress contributions

**Mostly SHIPPED; one REVIVE.** The queue row IS the standard launch
surface they're asking for: pending thread + typed wait + reason +
countdown + Send-now/cancel, rendered identically for every plugin with no
custom screens. Preflight = the hook's `reject(message)` (surfaced on the
composer with the draft kept). The gap is **progress**: a minutes-long
provisioning wait today shows one static reason. That is the cut
`report()` (steps/ETA/stall on the queued row) — revived by this consumer,
rendering in the row's wait line where the visual pass already left room.
Configuration rendering beyond that stays plugin-side (their settings/
dialog surfaces) — no new launch-screen framework.

## 6. Composer state handoff (structured draft export/import)

**NEW — and validated by our own history.** The scheduled-send build hit
exactly these limits: plus-menu surfaces could read draft text but not
attachments or resolvable mentions. `experimental_submit` solved
"submit-through-the-pipeline"; it did not solve "move a draft between
surfaces." A structured draft snapshot (text + mention refs + attachment
refs + execution selections) with export/import on the composer contract
is a real, self-contained surface. Design questions: merge policy on
import (their ask), and whether attachments transfer by reference
(uploaded blobs) or must re-upload. No existing cut covers this; it needs
its own small design round.

## Sequencing proposal

1. **Environments as a first-class noun** (unlocks 1 + 2, the sandbox
   author's core need) — the ownership/GC design round, then extraction.
2. **`pluginInputs` revival** (3's envelope) — smallest, returns as a unit.
3. **Amendments + provenance revival** (4's enforcement, also completes 1
   if chosen over env-independence for attachment).
4. **`report()` revival** (5's progress).
5. **Composer constraints + draft handoff** (4's UI layer, 6) — new design,
   after the enforcement layer exists.

Push-backs to communicate: no role framework (mapping provided), no
resolver registry (nouns over registrations), no `launchId` (pending
thread ids are the correlation).

## The strategic note

This gist is direct evidence in the curated-vs-ecosystem question: a third
party building a sandbox provider hit, independently, four of the exact
surfaces we cut for lacking consumers — and the revival cost is low
because each cut was recorded. The doctrine's bet is being tested in the
intended direction. It also validates the one warning the exercises kept
raising: every one of these six requests requires us to open a door.
