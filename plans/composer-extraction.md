# Shared composer extraction

## Status (2026-08-03): not started, and the premise moved

`useComposerArea` does not exist. Re-scope the plan before you build it:

- The side-chat site no longer hand-rolls the wiring. It now renders
  `EmbeddedThreadChat` (`components/thread/embedded-chat/`), which already
  shares composer hooks with `PluginThreadChat`. Two hand-rolled sites remain,
  not three.
- The Loops/Skills inline create box — the 4th site that motivated this — never
  landed as an inline composer. Skills and Loops create through a seeded
  composer instead, so there is no pending 4th caller.

Confirm the duplication is still worth an extraction before you start.

## Why

The prompt-composer wiring is hand-rolled **three times** today, and we need a
4th for the Loops/Skills inline create box. Rather than duplicate it again,
extract one shared hook and migrate the existing sites onto it.

No upstream work to piggyback on: checked `ymichael/bb` — 8 open PRs + last 20
merged. Composer-adjacent ones are fixes (#252 add-to-chat race, #247 prompt
shell breakpoint, #184 project-agnostic defaults) or a *timeline* reuse refactor
(#236) — none extracts the composer. No shared composer hook exists in the tree.

## The duplication (3 sites at the time of writing)

| Site | Box | Submit |
| --- | --- | --- |
| `views/RootComposeView.tsx` | `NewThreadPromptBox` | create new thread |
| `views/thread-detail/ThreadDetailPromptArea.tsx` | `FollowUpPromptBox` | steer / follow-up |
| `components/secondary-panel/SideChatTabContent.tsx` | `FollowUpPromptBox` | create side-chat thread (now `EmbeddedThreadChat`) |

All three assemble the same inputs via: `useThreadCreationOptions`,
`usePromptDraftStorage`, `usePromptMentions`, `useCommandSuggestions`,
`useUploadPromptAttachment`, `buildProviderPromptActionProps` → and build the
same `execution` / `permission` / `typeahead` / `attachments` / `composer`
configs that the box components require.

## Proposed shared hook

`useComposerArea(args)` in `apps/app/src/components/promptbox/useComposerArea.ts`:

- **Inputs:** `{ projectId, environmentId, threadId?, draftScope, initialProvider/model/permission?, … }` — everything the 3 sites pass differently.
- **Returns:** the assembled `{ executionConfig, permissionConfig, typeaheadConfig, attachmentsConfig, composer (draft+handlers), promptActions, providerPromptActionProps }` plus the draft + `threadCreationOptions` for the caller's submit.
- **Out of scope (stays per-site):** the box choice (`NewThreadPromptBox` vs `FollowUpPromptBox`), the submit handler (create-thread vs steer vs side-chat-create vs Loops/Skills create), and site chrome (project picker, branch/worktree, readOnly, trigger message).

## Migration order (de-risked, parity-first)

1. Build `useComposerArea` by lifting `SideChatTabContent`'s assembly verbatim (it's the most self-contained), parameterized.
2. Migrate `SideChatTabContent` onto it; confirm `SideChatTabContent.test` + a live side-chat smoke pass (parity).
3. Migrate `ThreadDetailPromptArea`; run its tests + steer/follow-up smoke.
4. Migrate `RootComposeView` (the most coupled — project picker/branch); run its tests + new-thread smoke. Keep `NewThreadPromptBox` as the box; only the config assembly comes from the hook.
5. Add the **Loops/Skills inline composer** (`InlineThreadComposer`) on top of the hook → creates a regular thread on submit, seeded; mount on both pages.

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/app`
- `pnpm exec turbo run test --filter=@bb/app` (RootCompose, ThreadDetailPrompt*, SideChat* suites)
- Live smoke each surface: new thread, steer a running thread, open a side chat, create from Loops + Skills.

## Risk / how to run

Touches the app's three core input surfaces — regressions are highly visible.
Best done as its **own focused PR/worktree** (isolated from the redesign branch),
parity-verified per step. Not a tail-end add to a large branch.

Delete this plan once the refactor merges.
