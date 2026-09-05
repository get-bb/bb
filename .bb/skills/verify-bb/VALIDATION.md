# Initial verification and maintenance pass

Executed on 2026-09-05 against source commit
`d284bd3ab5efcfa04105c03c9817d27504fbd69a`. Only verification documentation was
added during the run; product code was unchanged.

## Environment

Linux, Node 22.23.2, pnpm 9.15.0, `dev-browser@next` resolving to
`1.0.0-rc.3`, and headless Chromium. Desktop viewport: 1280 × 720.
Compact touch viewport: 390 × 844. The source dev launcher started a fresh
store and local host daemon. Project data was a synthetic empty Git repository.
A real authenticated Codex provider performed the short conversation.

## Live results

| Journey          | Observed result                                                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local project    | Added the fixture through the folder picker; selected it in compose; reloaded; API retained the exact local path, host, and default source.                                                                                                                                      |
| Thread lifecycle | Submitted through the UI; final output was exactly `BB verification complete.`; thread returned idle with no active turn; response survived reload; rename persisted; archive set `archivedAt`; unarchive cleared it and restored the composer. Fixture Git status stayed clean. |
| Appearance       | Dark theme survived reload in browser storage and the root class; Nord palette survived reload and the server config reported `nord`; original System/Default selections were restored.                                                                                          |
| Compact menu     | Theme drawer opened and realized its options; Light selection persisted; content remained mounted after close; reopen and Escape worked; app root was non-inert and exposed in the sampled states; original theme was restored.                                                  |

The generated launch block was executed from the skill on a second fresh
store. All four recipes were then driven through the live UI, supplemented by
API reads and the source CLI. Screenshots were inspected. The creation and
maintenance skills were also reviewed in a fresh agent context for creation,
audit, and explanation-only requests; that review was a static contract check,
not a behavioral benchmark of skill triggering.

## Corrections from execution and review

- Use the supported Node 22 runtime. The exploratory Node 24.18.0 launch
  crashed in native-module setup; Node 22 startup succeeded without product
  changes. This records the observed setup result, not a diagnosed Node bug.
- Check all three ports before invoking `current`: the launcher stops their
  listeners before startup. Stopped screen sessions alone do not prove the
  ports are unused.
- Mark a fresh dev directory before startup so legacy dev data is not adopted.
- Wait for the chosen folder's breadcrumbs before submitting Add project.
- Reopen the saved thread URL after Archive navigates away.
- Wait for menu options separately from the compact drawer shell, and limit
  root accessibility claims to observed states.

## Limits

This is a smoke pass over the four mapped journeys, not whole-product QA.
It does not verify Safari/iOS, Electron, remote hosts, Connect, steering,
cancellation, tool execution, worktree creation, or performance. Existing
drawer regression tests and iOS Simulator checks remain required when that
implementation changes. No product tests were added for these documentation
changes.

Raw screenshots, selected state observations, scripts, and logs are retained
in the creating thread's local verification run directory. They are excluded
from Git because they include machine paths and provider labels. The run
restored settings, stopped its named browser and checkout-owned processes,
and retained evidence outside the disposable dev data directory.
