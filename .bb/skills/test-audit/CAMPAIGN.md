# Test-pruning campaign

Campaign mode prunes one subsystem's whole test surface in one PR: a plugin
such as `plugins/provider-codex`, or one app or package such as
`apps/host-daemon`. The value bar, retention bar, candidate evidence, and
validation in [SKILL.md](SKILL.md) apply to every lane. This file adds the
order of work. Each step ends on its completion criterion; do not start the
next step early.

## 1. Baseline

Record the subsystem's test and support line counts and every test file's
pass/fail state at a pinned `main` SHA, captured in a detached worktree. Keep
baseline failures in their own list. Rule out the environment-only failures
named in SKILL.md, confirm the rest on clean `main`, and treat each survivor
as a possible product bug, not a stale test.

Done when every in-scope test file has a recorded baseline result.

## 2. Lanes and inventory

Split the surface into **lanes** along production owner boundaries, not file
prefixes. For `plugins/provider-codex` these might be the AI service and auth,
app-server transport, bridge lifecycle (resume, recovery, archive), event
translation, interactive requests, models and usage, and presentation.
Include the subsystem's cases at shared core boundaries (`apps/server`,
`packages/agent-runtime`, `tests/integration`), its parity recordings and
corpus gates, and any off-pipeline suites it owns.

Done when every test file and recorded or live scenario the subsystem owns
belongs to exactly one lane.

## 3. Read-only ledger per lane

Give each lane to its own read-only agent. The agent reads every assigned test
in full, including parameter tables. It also reads the production owners and
their entry points, callers, history, and CI routing. Each test declaration
goes into a written **ledger** with one mark. An `it.each` is one declaration
unless its rows need different marks; then mark each row.

- `R`: retain, naming the contract and the bug it catches; a retained test that
  only moves to a better-named file stays `R` with the move noted;
- `F`: retain the contract but repair the assertion, such as a vacuous negative
  that passes when only one of several items is missing;
- `C`: consolidate, naming the owner that absorbs the assertion first: a sibling
  table case, a stronger boundary suite, or the shared owner in another package;
- `D`: delete, naming the proof that remains, or why no contract exists.

Judge a test by its assertions, not its name; a test named for retiring a
window may assert the window was _not_ cleared.

Done when every declaration in the lane has a mark and an evidence line.

## 4. Layer plan per lane

Treat the per-test ledger as input, not as the edit list. A second read-only
pass, starting from the ledger, looks for the redundant **layer**, such as
several suites replaying one shared helper through the same mock around a
stronger real-transport suite. Name the **keeper** suite for each contract.
Prefer the real boundary with a fake network or scripted provider
(`tests/scripted-echo-provider`) over a mocked collaborator, and a fake that
loads the real plugin code over one that stubs it. Correct any ledger errors
this pass finds.

Done when each lane plan names its retired files, its keeper per contract, the
assertions to carry into keepers, and the test-only production seams unlocked.

## 5. Cutover

Edit lane by lane. Serialize changes to shared harnesses and support files
(`packages/test-helpers`, `@get-bb/plugin-sdk/testing`) through one owner.
With each lane, remove the test-only production seams it unlocks: injection
parameters, getters, reset exports, and indirection layers, but not published
Plugin SDK exports. Keep moved suites inside their package's Vitest `include`
globs and the owning Turbo task's `inputs`. Change committed expectations only
through their documented update path, such as `UPDATE_PARITY_ROW_COUNTS=1`.
Propose durable test-ownership rules drawn from mistakes this campaign
actually found for `AGENTS.md` in the PR body.

Done when every lane plan is applied and each lane's keepers pass.

## 6. Preservation review

Before claiming completion, have independent reviewers compare deleted
coverage against the keepers, one reviewer per boundary group. They look for
contracts that lost their only proof. They also look for new assertions that
cannot fail, such as a rejection row the production code never reaches.

For each deleted, merged, or restored contract, make one deliberate
**mutation** of the production owner. Confirm it fails the old test in the
baseline worktree and a keeper in the campaign worktree, then restore the
source byte for byte.

Done when every reported gap is restored or rejected with source evidence, and
every restored contract has a caught mutation.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it at its
owner as a separate commit, and prove it through the real user flow, with a
**control** run that reverts the fix and shows the old behavior. Record
unrelated product discrepancies you find as follow-ups instead of fixing them
in the campaign.

Done when each repaired defect has a failing control and a passing candidate
on the same harness.

## 8. Reconcile and hand off

Campaigns outlive many `main` commits. Merge `main` rather than rebasing a
long, many-commit campaign. When `main` modified a file the campaign
deleted, keep the deletion. Port the new contract into the keeper instead, and
confirm every new regression `main` added still has a home. After the merge,
confirm every deleted file is still absent; a modify/delete resolution can
silently restore one. Rerun the whole subsystem suite, its off-pipeline
suites, and live proof on the merged head.

Expect review tooling to see a truncated file list on a diff this large.
Record maintainer decisions for generic compatibility flags in the PR evidence
rather than editing gates.

Hand off with the [SKILL.md](SKILL.md) report, plus:

- baseline and final test/support line counts, with production counted separately;
- lanes, retired layers, and keepers;
- preservation gaps found and their mutations;
- product defects with control and candidate proof.
