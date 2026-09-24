# bb cloud AI

Registers the `bb` AI service. For a signed-in bb account that has turned bb
cloud on, it writes thread titles and commit messages through getbb.app's
hosted gateway (`POST /api/ai/v1/complete`), which calls OpenRouter's
zero-data-retention endpoints and meters spend per account per UTC day.

The plugin holds no credential. Every hosted call goes through the `bb-account`
plugin's `bb-account.v1.fetch` RPC, and readiness comes from
`bb-account.v1.status`. The copied schemas live in `src/account-contract.ts`;
any account state other than `signed-in` counts as signed out.

- bb cloud is opt-in. The choice is stored in this plugin's kv under `enabled`
  and defaults to off, so a signed-in account (including one adopted from a
  Connect pairing) sends nothing until the user turns it on in Settings → bb
  cloud AI, with `bb ai on`, or through the `setEnabled` RPC.
- `complete(prompt)` posts `{ prompt }` with `timeoutMs: 5000` and returns
  `text`. It refuses without contacting getbb.app while bb cloud is off, signed
  out, or out of budget. Gateway errors become rejections.
- A `402 budget_exhausted` answer marks the service not ready until its
  `resetsAt` for that account only (API origin plus user id), so Automatic
  skips it; signing in to another account is unaffected. An answer that arrives
  after the signed-in account changed is not recorded.
- `status()` is not ready while bb cloud is off, when bb-account is not
  running, when the account is signed out, or while the account's daily budget
  is used up. Each message says what to do.
- The `overview` RPC feeds the settings section; `bb ai status|usage` prints
  the same data, and `bb ai on|off` changes the opt-in. Every command takes
  `--json`.

What leaves the machine while bb cloud is on: the text of a thread's first
prompt (titles) and the changed files with a diff excerpt (commit messages).
getbb.app stores daily usage totals and, for 30 days, per-request metadata
(time, server, model, token counts, cost, latency, outcome); it never stores prompts or replies.

Voice transcription is phase 2 (see the plan's Part 8).
