# bb cloud AI

Registers the `bb` AI service. For a signed-in bb account it writes thread
titles and commit messages through getbb.app's hosted gateway
(`POST /api/ai/v1/complete`), which calls OpenRouter's zero-data-retention
endpoints and meters spend per account per UTC day.

The plugin holds no credential. Every hosted call goes through the `bb-account`
plugin's `bb-account.v1.fetch` RPC, and readiness comes from
`bb-account.v1.status`. The copied schemas live in `src/account-contract.ts`.

- `complete(prompt)` posts `{ prompt }` and returns `text`. Gateway errors
  become rejections. A `402 budget_exhausted` answer marks the service not ready
  until its `resetsAt`, so Automatic skips it.
- `status()` is not ready when bb-account is not running, when the account is
  signed out, or while the daily budget is used up.
- The `overview` RPC feeds the settings section; `bb ai status|usage` prints
  the same data.

Voice transcription is phase 2 (see the plan's Part 8).
