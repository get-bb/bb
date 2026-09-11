# PR #3456 mobile follow-up screenshots

Source head: `4573d1f75bfca1ba180d8d6ef85d1339bf0d9965`.
Captured 2026-09-10 from the running `pnpm start:worktree` production build, Chromium touch emulation, 390 x 844 CSS pixels at 2x resolution. Both threads are synthetic fixtures using the same initial prompt and follow-up. No screenshot contents were edited.

- Before: restore the original Stop button binding (`onClick={onStop}` without the pointer-down guard) only in the browser's intercepted JavaScript response. The same trusted touch gesture dispatched pointerdown/pointerup on Steer, then click on Stop. The real server recorded one manual-stop interruption. The pending steer subsequently completed; the captured thread is idle, with the interrupted command and Stopped manually row visible. Reloaded to display persisted state.
- After: unmodified build of the named head. The same trusted pointerdown/pointerup on Steer and trailing click on Stop delivered one follow-up while the real thread remained active, with zero interruption events. The screenshot shows the running command, follow-up, Working indicator, and Stop control.

Served bundle: `workspace-checkout-display-1-hr19RF.js`.
Original bundle SHA256: `6a75d9aa570f6e8ed206ce0705714af67c3b451ddd507d26cc6f286c35e7e7df` (matches local final build).
Before-only response substitution (matched exactly once):

```text
"aria-label":`Stop run`,onPointerDown:Pn,onClick:Fn,
→
"aria-label":`Stop run`,onClick:L,
```

Native iOS/Android were not tested. The worktree server remains running for handoff.
