# bb cloud AI

Registers the `bb` AI service. For a signed-in bb account that has turned bb
cloud on, it writes thread titles and commit messages (`POST
/api/ai/v1/complete`) and transcribes voice input (`POST
/api/ai/v1/transcribe`) through getbb.app's hosted gateway, which calls
OpenRouter's zero-data-retention endpoints and meters spend per account per
UTC day.

The plugin holds no credential. Every hosted call goes through the `bb-account`
plugin's `bb-account.v1.fetch` RPC, and readiness comes from
`bb-account.v1.status`. The copied schemas live in `src/account-contract.ts`;
any account state other than `signed-in` counts as signed out.

- bb cloud is on by default. The choice is stored in this plugin's kv under
  `enabled`; with nothing stored it is on, and a stored `false` (from
  `bb ai off` or the `setEnabled` RPC) keeps it off across reloads. Only a
  client call may change it; another plugin's `setEnabled` is refused.
- `complete(prompt)` posts `{ prompt }` with `timeoutMs: 5000` and returns
  `text`. `transcribe(audio, { hint })` posts `{ audio, format, hint }` (base64
  audio, a format derived from the MIME type or file extension) with
  `timeoutMs: 10000`, and refuses recordings over 10 MB or in formats
  OpenRouter does not take. Both refuse without contacting getbb.app while bb
  cloud is off, signed out, or out of budget. Gateway errors become rejections.
- A `402 budget_exhausted` answer marks the service not ready until its
  `resetsAt` for that account only (API origin plus user id), so Automatic
  skips it; signing in to another account is unaffected. An answer that arrives
  after the signed-in account changed is not recorded.
- `status()` is not ready while bb cloud is off, when bb-account is not
  running, when the account is signed out, or while the account's daily budget
  is used up. Each message says what to do.
- The `overview` RPC reports the account, readiness, and usage; `bb ai
status|usage` prints the same data, and `bb ai on|off` changes the setting.
  Every command takes `--json`.
- The gateway picks the models (`AI_TRANSCRIBE_MODELS` in
  `apps/ai-gateway/wrangler.jsonc`: MAI-Transcribe 2, then Whisper Large V3
  Turbo) and moves to the next one when a model refuses. Through OpenRouter,
  MAI refuses WebM and MP4, so Chrome and Safari recordings are transcribed by
  Whisper.

What leaves the machine while bb cloud is on: the text of a thread's first
prompt (titles), the changed files with a diff excerpt (commit messages), and
voice recordings with the vocabulary hint (voice input), plus any thread title
instructions you add in Settings → AI services. getbb.app stores daily
usage totals and, for 30 days, per-request metadata (time, server, model, token
counts, cost, latency, outcome); it never stores prompts, recordings, or
replies.
