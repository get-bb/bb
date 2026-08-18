# Plan: unify the plugin SDK `openPanel` contract

## Status

The contract half (steps 1, 2, 3, 5, 6 minus the side-chat test) is
implemented. Step 4 (the side-chat consumer) was dropped: a separate change
moves side chat to create its fork lazily on first send, which removes the
fork that would have been orphaned, so the cleanup question below is moot.

One thing the implementation turned up that this plan got wrong: the widening
is **not** fully source-compatible after all (see "Risk"). Because
`run` is declared `void | Promise<void>`, a concise-arrow `run` that returns
`openPanel(...)` — including `run: async ({ openPanel }) => openPanel({...})`,
the form the built-in `bb-plugin-authoring` skill documented — no longer
typechecks; the body needs braces. Three in-repo call sites and both skill
examples were fixed that way, and the skill now says so. The open decision,
deliberately not taken here: whether `run`'s declared return should widen
(e.g. to `unknown`, whose return the host already ignores apart from awaiting
a promise) so concise arrows keep working for external plugins on upgrade.

## Problem

`@get-bb/plugin-sdk/app` exposes four ways for a plugin to ask the host to
open a thread-side-panel tab, and they disagree on how the host reports
whether the panel actually opened.

| Entry point | Return | Declared in |
| --- | --- | --- |
| `PluginMessageActionContext.openPanel` | `boolean` | `packages/plugin-sdk/src/app-contract.ts:760` |
| `PluginThreadPanelActionContext.openPanel` | `void` | `packages/plugin-sdk/src/app-contract.ts:311` |
| `PluginNewThreadPanelActionContext.openPanel` | `void` | `packages/plugin-sdk/src/app-contract.ts:353` |
| `useBbNavigate().openThreadPanel` | `boolean` | `packages/plugin-sdk/src/app-contract.ts:1398` |

A plugin that registers more than one kind of action therefore cannot write
one open-the-panel routine. Our own first-party plugin already pays for
this: `plugins/side-chat/app.tsx:115` declares its shared helper as
`openPanel(options): unknown` purely so the `boolean` message-action context
and the `void` panel-action context both satisfy it.

There is a second, quieter inconsistency behind the type difference — how the
two host implementations report an invalid `params` value:

- Message-action path: `serializePluginPanelParams` is called inside the host
  handler (`apps/app/src/views/thread-detail/ThreadDetailView.tsx:1290`),
  which catches, `console.warn`s, and returns `false`.
- Panel-action path: `serializePluginPanelParams` is called directly inside
  `openPanel` (`apps/app/src/components/plugin/PluginPanelActions.tsx:62`
  and `:101`), so the same bad input *throws out of `openPanel`* into the
  plugin's `run`.

So today the same mistake is a return value on one surface and an exception
on another.

### It is not only cosmetic

`messageAction.openPanel` returns `false` for real, reachable reasons:

1. The action id does not resolve to a `threadPanelAction` of the same plugin.
2. `params` is not JSON-serializable.
3. **The surface has no thread side panel.** Only `ThreadDetailView` supplies
   `onOpenPluginPanel` (`apps/app/src/views/thread-detail/ThreadDetailView.tsx:2921`);
   every other `ThreadChat` mount — notably a `ThreadChat` a plugin embeds
   inside its own panel — passes `undefined`, and
   `apps/app/src/lib/plugin-message-actions.ts:42` then returns `false`.

Case 3 is live in shipped behavior: "Reply in side chat" is a
`messageAction`, so it renders on every message of every `ThreadChat`,
including the one side-chat itself renders inside its panel. Invoked there,
`createAndOpenSideChat` creates the hidden fork thread over RPC and *then*
calls `openPanel`, whose `false` is discarded
(`plugins/side-chat/app.tsx:177`). The user gets no panel, no toast, and an
orphaned fork thread. `examples/plugins/thread-chat-demo/app.tsx:118` is the
only caller that checks the boolean at all.

The `void` surfaces are not currently able to fail — a panel action is
launched from a launcher inside the panel it opens into, and the action id is
the action itself — but a plugin cannot know that from the types, and the
asymmetry is what forces the `unknown` workaround.

## Proposal

Make all three registration-callback `openPanel`s return `boolean`, matching
`useBbNavigate().openThreadPanel`, and make "host declined" a return value on
every path rather than an exception on some.

Why `boolean` rather than making everything `void`:

- `messageAction.openPanel` has a genuine, non-exceptional failure the plugin
  should react to (show a toast, skip the RPC, unwind).
- `run` errors are contained and logged by the host
  (`PluginPanelActions.tsx`, `plugin-message-actions.ts`), so a thrown error
  is a *worse* signal than a return value: it is swallowed unless the plugin
  wraps every call.
- Widening `void` → `boolean` on a host-provided function is source-compatible
  for existing plugins: code that ignores the result keeps compiling. No
  plugin needs to change to keep working.

Why not a richer `{ opened, reason }` result: nothing today branches on *why*
an open was declined, and the host already `console.warn`s the diagnosable
cases. A discriminated result can be added later without another break; going
straight to it now buys nothing and complicates every call site.

## Work

1. **Contract** (`packages/plugin-sdk/src/app-contract.ts`)
   - `PluginThreadPanelActionContext.openPanel` and
     `PluginNewThreadPanelActionContext.openPanel` → `boolean`.
   - Rewrite all three doc comments to state one rule: returns `true` when the
     host accepted the open; `false` when it declined — unknown/unavailable
     action id, no thread side panel on this surface, or non-JSON `params`.
     Note that a decline is `console.warn`ed by the host.
   - Consider naming the shared options shape once
     (`PluginMessageActionThreadPanelOptions` already exists for the
     `actionId`-carrying variant) so the three signatures read as one family.
   - Bundled `.d.ts` under `packages/plugin-sdk/bundled-types/` is generated by
     `scripts/build-bundled-dts.mjs`; do not hand-edit — regenerate via
     `pnpm exec turbo run build --filter=@get-bb/plugin-sdk`.

2. **Host — panel actions** (`apps/app/src/components/plugin/PluginPanelActions.tsx`)
   - In both `openPanel` closures, wrap `serializePluginPanelParams` in
     `try`/`catch`: on failure `console.warn` with the existing
     `[plugin:<id>] <slot> "<action>"` prefix and return `false`; otherwise
     open and return `true`.
   - The two closures are now identical apart from the slot label — factor out
     one helper rather than duplicating the third copy.

3. **Host — message actions** (`apps/app/src/lib/plugin-message-actions.ts`)
   - The no-panel-surface branch currently returns `false` silently. Add the
     same `console.warn` so all three decline paths are diagnosable from the
     console. (Behavior otherwise unchanged.)

4. **First-party plugin** (`plugins/side-chat/app.tsx`)
   - Type the shared helper's `openPanel` as
     `(options: { title: string; params: SideChatPanelParams }) => boolean`
     and drop the `unknown` workaround — this is the change that proves the
     contract is uniform.
   - Handle `false` in `createAndOpenSideChat`: today it silently strands the
     hidden fork. Order the work so the fork is only created once we know a
     panel can receive it — check openability first, or on `false` surface a
     `toast.error` ("Side chat can only be opened from the main thread view")
     and clean up / do not leave the user with an invisible thread. Confirm
     with the side-chat backend RPC what cleanup, if any, is available; if
     none, prefer the check-first ordering.

5. **Example + docs**
   - `examples/plugins/thread-chat-demo/app.tsx` already checks the boolean;
     leave as the reference pattern.
   - `packages/plugin-sdk/README.md` mentions `openThreadPanel`; add one line
     that every panel-open entry point returns `boolean`.
   - `docs/api_to_audit.md` — `experimental_newThreadPanelAction` is the only
     one of the three still `experimental_`; its entry §5 talks about the
     relationship to `threadPanelAction`. Update it to record that the two
     `openPanel` signatures were unified, so the eventual stabilization audit
     does not re-litigate it.

6. **Tests**
   - `plugins/side-chat/app.test.tsx` already stubs `openPanel` as
     `vi.fn(() => true)`; add a case where it returns `false` and assert the
     plugin surfaces the failure instead of silently swallowing it (this is
     the regression test for the orphaned-fork bug).
   - Add a host test that a `threadPanelAction` whose `run` passes
     non-JSON `params` gets `false` (not a throw) and that the launcher does
     not open a tab.
   - Add a host test that `messageAction.openPanel` returns `false` on a
     surface with no thread panel — pin the behavior the side-chat fix relies
     on.

## Verification

- `pnpm exec turbo run typecheck --filter=@get-bb/plugin-sdk --filter=@bb/app`
- `pnpm exec turbo run test --filter=@get-bb/plugin-sdk --filter=@bb/app > /tmp/openpanel-test.txt 2>&1`
- `pnpm exec turbo run lint` on every touched package (react-compiler lint
  errors fail CI).
- Manual: open a side chat from the main timeline (opens), then invoke "Reply
  in side chat" from inside a side-chat panel (must now report failure rather
  than stranding a fork).

## Out of scope

- Changing `useBbNavigate().openThreadPanel`; it is already `boolean` and this
  plan aligns to it.
- Any `{ opened, reason }` result shape — deliberately deferred (see above).
- Giving panel-action surfaces new failure modes; step 2 only changes how an
  already-possible failure is *reported*.

## Risk

Low. The type change is a widening, so no plugin is source-broken. The one
behavior change a plugin could observe is invalid `params` in a panel action
no longer throwing — reachable only by a plugin that both passes non-JSON
params and wraps its own `openPanel` call in `try`/`catch`. No wire protocol
is involved, so `HOST_DAEMON_PROTOCOL_VERSION` is untouched.
