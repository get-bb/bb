# Codex MCP elicitation live verification

Verified on 2026-10-02 against implementation commit
`eecf17fc2b4e00a79e930635ddfef8eca62cf1bd`, for #4645 and PR #4729.

## Environment and method

An isolated BB source build ran through `pnpm start:worktree` under Node 22.19.0,
with its own database and listeners at `127.0.0.1:21889` (server/app) and
`127.0.0.1:29889` (daemon). The loaded `provider-codex` plugin's root was
`packages/bundled-plugins/dist/provider-codex` in the worktree, not the installed
BB application. Its host bundle SHA-256 was
`f018cbb7a0eb3055c087760e68a65e396024abd026ea20fc236e4e310e885d4b`.
The isolated build was BB 0.44.0 with Codex CLI 0.160.0.

The user explicitly authorized a test Codex thread. It ran in `accept-edits`
mode and called the actual native Computer Use MCP tool. The user answered the
real dialogs in the isolated BB UI. The agent did not submit interaction answers
through the CLI or API. CLI/API reads inspected persisted results, and Codex's
native rollout supplied the original tool outputs. No harness, alternative GUI
automation, permission-file edits, or replacement/restart of the installed BB
or its shared services was used.

Test thread: `thr_qxr3ihgx24`.
Codex session: `01a0fd52-ecb4-7af0-bcf7-10d419179e78`.

## Observed results

| Scenario                       | Actual request/action                                                                                                             | Observed result                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool consent                   | `let app = await cua.getApp("bb");` triggered `Allow the cua_repl MCP server to run tool "js"?`                                   | The human chose Always allow. Interaction `pint_c6mx2mcnjr` resolved with `action: accept`, `content: {}`, `persist: always`.                                                                                                                              |
| App consent                    | The same call then triggered `Allow Computer Use to use "bb"?`                                                                    | The human chose Always allow. Interaction `pint_jdbfh33z2e` resolved with the same accepted values. The real tool returned the BB window's accessibility tree.                                                                                             |
| GUI read                       | `await app.getScreenshot();`                                                                                                      | The native tool returned a JPEG of the real BB window. The image was inspected locally.                                                                                                                                                                    |
| Decline                        | `let declinedApp = await cua.getApp("Calculator");`                                                                               | The human chose Decline. `pint_6yqwsnmie2` resolved with `action: decline`; Computer Use returned `Computer Use was not approved to use Calculator`. No further app operation was performed.                                                               |
| Cancel                         | A separate `getApp("Calculator")` request                                                                                         | The human chose Cancel. `pint_3g9xyb4uvg` resolved with `action: cancel`; Computer Use returned the same refusal text. The persisted action distinguishes cancellation from decline.                                                                       |
| Stop while awaiting            | A new Calculator request was left unanswered; the test thread was stopped using `bb thread stop`                                  | `pint_edjvevgr2p` became `interrupted`, with `resolution: null` and reason `Provider turn interrupted while awaiting user interaction`. The pending list became empty.                                                                                     |
| App-server disconnection       | A new unanswered Calculator request; SIGKILL to the verified Codex app-server child of the isolated daemon                        | `pint_274793fb6f` became `interrupted`, with `resolution: null` and reason `Provider turn failed while awaiting user interaction`. The thread entered error and the pending list became empty. Both BB servers and the isolated daemon remained available. |
| Recovery and persisted consent | Resume the same BB thread, then `let recoveredApp = await cua.getApp("bb");` and a separate `await recoveredApp.getScreenshot();` | A new Codex process returned the real BB window and a new JPEG without another consent request. The human's Always allow choice survived the process restart.                                                                                              |

The initial successful native outputs were recorded at 15:55:38 and 15:55:45 UTC;
the post-disconnection outputs were recorded at 16:06:18 and 16:06:25 UTC.
Both accessibility results named the window `Исправить проблему из issue #4645`.

The original native screenshot SHA-256 values are:

- Initial: `c8be0453c47f80e986a197291df93f254b680b0ffbfa0a0323cb9a5ee47ab813`.
- Recovery: `c5c4705cf3ec64bfd6c3650f6ae1d93bc86bd5cbb7e1f398acf4b68aff0d5935`.

Screenshots and full accessibility trees remain private because they contain
personal workspace contents. Sanitized interaction records and selected native
output metadata were retained with the local verification evidence.

## Repeating the check

1. Follow `docs/debugging-and-qa.md` to start an isolated worktree build. Confirm
   the listeners, data directory, and loaded provider plugin belong to that build.
2. With the user's authorization, create a Codex test thread in `accept-edits`
   mode. Ask it to call the native Computer Use `cua.getApp("bb")`, wait for the
   human's decision, and, after access is granted, obtain a native screenshot.
3. Have the human answer the actual BB interaction cards. Inspect them through
   `bb thread interactions show`; compare with original native tool outputs.
4. Use an unapproved app to exercise Decline and Cancel. Do not erase saved
   permissions to manufacture prompts, and do not automatically answer them.
5. For stop/disconnection, leave a request pending. Stop only the test thread,
   or terminate only its verified app-server process. Require `resolution: null`,
   terminal interaction state, and an empty pending list before resuming.

## Limits

This live run covers empty confirmation forms, real native app access, actual
accept/decline/cancel decisions, turn stop, app-server loss, recovery, and Always
allow persistence. Typed forms and invalid/unsupported schemas were covered by
automated tests, not this live run. Session-only persistence and Browser Use
site consent were not exercised. The check establishes working OS permissions
on this Mac; it does not validate other machines' permission configuration.
