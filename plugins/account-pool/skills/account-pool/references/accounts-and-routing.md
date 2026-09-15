The builtin Account Pooler plugin is disabled by default. Enable it, add Claude
or Codex credentials, and inspect its proxy routes and account quota with:

```sh
bb plugin enable account-pool
bb pool account add --provider claude --login
printf '%s\n' "$CLAUDE_AUTH_CODE" | bb pool account login-complete --session <id> --code-stdin
bb pool account add --provider codex --login
bb pool account login-poll --session <id>
bb pool account add --provider claude --import
bb pool account add --provider codex --import
printf '%s\n' "$ANTHROPIC_API_KEY" | bb pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]
bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]
bb pool account list [--json]
bb pool account remove <id>
bb pool account enable <id>
bb pool account disable <id>
bb pool account priority <id> <n>
bb pool account reorder <claude|codex> <id>...
bb pool account refresh <id>
bb pool status [--json]
bb pool routing <claude|codex> [--off]
bb pool config
bb pool config set <anthropicUpstreamBaseUrl|codexUpstreamBaseUrl|switchThreshold|parentMode|cacheMissDebug|cacheMissMinTokens> <value>
bb pool cache-miss list [--json]
bb pool cache-miss clear
bb pool token rotate --machine <id-or-name>
bb pool bypass <thread-id> [--off]
```

Claude `--login` starts a PKCE session, prints a browser URL and session ID,
then exits. Pipe the manual callback code to `account login-complete` with that
session ID within ten minutes. Codex `--login` prints a device verification
URL, one-time code, session ID, and an `account login-poll` command that waits
for authorization. The Claude code stays out of process arguments, and either
browser may be on a different machine from the bb server. Newly added or
enabled accounts are available without a plugin reload. With an
enabled account whose secret file remains readable and valid, matching Claude
Code or Codex sessions receive the pool route and a distinct secret token for
their machine.
Codex receives `CODEX_OPENAI_BASE_URL` and the secret
`CODEX_POOL_AUTH_TOKEN`; bb applies them as in-memory app-server config.
Codex image generation and editing use the same authenticated pool route.
Tokens are never printed. `status` prunes tokens for unenrolled machines and
shows token timestamps plus recently routed threads whose machines need a
local Claude login before the pool can be disabled safely. Rotation keeps the
prior token valid for ten minutes. Agents should pipe API keys to
`--api-key-stdin`;
`--api-key <key>` is an unsafe compatibility form that exposes the key in
process arguments, shell history, and agent transcripts. Prefer `--import` for
an existing Claude Code login. The CLI Codex import path reads
`~/.codex/auth.json` on the bb server host. OAuth quota refreshes on add or
enable and every five minutes while an account is idle. Use
`bb pool account refresh <id>` to request an immediate refresh for one account.
Account tables add columns for observed model-family buckets; JSON status
exposes their utilization, reset, status, observation time, and source under
`familyWeekly`. Selection skips an account whose requested family is spent
while retaining it for other families. A present `metadata.user_id` account
UUID is aligned with the selected OAuth account. Use `bb pool config` to
inspect the full routing configuration and
`bb pool config set <key> <value>` to update one value. The upstream URL keys
are QA-only overrides; `switchThreshold` must be greater than 0 and at most 1.

Accounts run sequentially per provider: lower priority numbers first, with ties
following the order accounts were added. New conversations use the current
account until it reaches the switch threshold or fails; the pool then advances
to the next eligible account and wraps at the end. It keeps using that fallback
even when an earlier account recovers. Existing conversations stay pinned while
their account remains eligible. Short temporary rate limits wait on the same
account once; longer holds return Retry-After for pinned conversations while new
conversations can advance. A model-family limit detours only requests for that
family without moving the session's main pin or the provider cursor. The cursor
and session pins survive hub restarts. Session pins expire after 30 idle minutes,
and the pool retains the 4,096 most recently used pins.

Drag an account’s handle in Account Pooler settings (or focus the handle and use
Space, arrow keys, and Space again), or
`bb pool account reorder <claude|codex> <id>...`, to set the complete order for
one provider. Include disabled accounts too. Reordering changes the next failover
sequence without moving the current account. `bb pool account priority <id> <n>`
sets an individual priority; the same operations are available through the
`account.reorder` and `account.setPriority` plugin RPCs.

## Nested bb servers

A bb server started from inside another bb server's thread inherits that parent's
pooler routing through its environment. The parent contributes
`BB_ACCOUNT_POOL_PARENT_URL` and `BB_ACCOUNT_POOL_PARENT_TOKEN` alongside the
provider routing variables, and the nested server enables the pooler on first run
when it sees them.

`bb pool parent` reports the detected parent, the current mode, and which
providers the parent can serve. `bb pool parent proxy` and `bb pool parent
isolate` set the mode; `bb pool config` shows it as `parentMode`.

In `proxy` mode the nested server runs its own hub and mints its own machine
tokens, forwarding pooled traffic upstream with the parent's token, so the
parent's token is never handed to the nested server's agents. It reads the
parent's `/availability` endpoint and contributes routing only for providers the
parent can actually serve; if the parent is unreachable it contributes nothing
and neutralises the inherited values rather than pointing agents at a dead hub.

In `isolate` mode the nested server contributes empty routing variables, which
overrides the inherited values so threads fall back to that instance's own
accounts or to each provider's own credentials.

Proxied traffic authenticates as the parent machine's token, so `bb pool status`
on the parent attributes it to the parent host rather than to the nested
instance.

## Cache miss debugging

Turn on reports with `bb pool config set cacheMissDebug true` or the cache miss
debugging switch in Account Pooler settings; `false` is the default. While it is
on, the hub follows successful Claude `/v1/messages` and Codex `/v1/responses`
requests that carry a provider session id and report usage. Claude requests
with no `cache_control` breakpoint are not tracked, because the API neither
reads nor writes the prompt cache for them. Debugging adds no parsing before a
request goes upstream: the hub decodes and parses the request body in a later
event-loop turn after the first response chunk is forwarded, then drops the raw
body, and pairing and analysis run after the client has received the end of the
response.

The hub pairs each request with the earlier request from the same session on
the same host that shares the longest prompt prefix, preferring one whose whole
prompt this request repeats. Claude sub-agent requests pair only with earlier
requests that repeat their entire first user message, so a new sub-agent is not
compared with a sibling. A Codex thread that names a parent thread is compared
with a parent request only when its prompt continues that request, as a fork
does; spawned agents and reviewers that start their own history are not paired
with the parent. Codex lite requests rebuild the tools item and base
instructions message at the start of `input` with ids derived from the thread
id, so the comparison leaves those two ids out and a fork still continues its
parent's prompt. Expected cached tokens are that earlier request's cache reads
plus cache writes for Claude, or its prompt size for Codex, capped at this
request's prompt size. Missed tokens are the expected cached tokens minus the
tokens this request read from cache. A miss is reported when missed tokens
reach `cacheMissMinTokens`, a positive integer that defaults to `10000`.
`count_tokens` and failed responses are not tracked.

A report lists every cause that applies, in this order:

- `account-switch`: the earlier request used another pooled account; prompt
  caches are isolated per organization.
- `model-change`: the model changed.
- `idle-gap`: more time passed between the times the hub sent the two requests
  upstream than the cache lifetime: 5 minutes for Claude, 1 hour for a Claude 1h
  breakpoint, and 30 minutes for Codex. OpenAI documents at least 30 minutes of
  cached-prefix retention for GPT-5.6 and later; older models can drop prefixes
  after 5 to 10 idle minutes, and such a shorter gap is reported as
  `unexplained`. Rate-limit waits and failed failover attempts before a request
  was sent do not count toward the gap.
- `concurrent-request`: this request started before the earlier response began.
- `parameter-change`: cache-relevant request parameters or headers changed. For
  the `anthropic-beta` header the message names the betas that were removed and
  added.
- `compaction`: history was rewritten (compaction, rewind, or cleared context).
  A Claude request counts as rewritten when it has fewer assistant messages than
  the earlier request or a history block was removed, so system messages that
  Claude Code folds into user messages do not count.
- `prompt-change`: a prompt segment was modified, inserted, or removed. The
  report names the first divergent path, such as `tools[1]`, `system[0]`,
  `messages[4].content[0]`, `instructions`, or `input[3]`.
- `lookback-window`: Claude only; the cache breakpoint moved 20 or more
  positions with no prompt change.
- `unexplained`: none of the above; the message states how long after the
  previous request this one started. The provider likely evicted the entry or
  routed the request to another backend.

`bb pool cache-miss list` prints each report's time, provider, model, session
id, host, account, token counts, causes, and the divergent segment with
indented excerpts. For a modified segment it prints the start both excerpts
share once as `unchanged:`, then `before:` and `after:` from the first
differing character; the settings page shows the same excerpts with escaped
line breaks as real line breaks and highlights the text from the first
difference on. `--json` prints
`{ "reports": [...], "cacheMissDebug": <boolean>, "forwardsToParent": <boolean> }`
with the full excerpts, so a script can tell an empty list from reporting that
is off or left to a parent pool. `bb pool cache-miss clear` removes the
reports. The `cacheMiss.list` and `cacheMiss.clear` plugin RPCs return the same
reports.

Reports and prompt snapshots live only in server memory, and nothing is written
to disk. The pool keeps the newest 50 reports. Snapshots cover up to 64
conversations. Each conversation keeps the newest 8 requests of its main loop
and of each of up to 16 sub-agents, where a sub-agent is identified by its
first user message, and the least recently active sub-agent is dropped first.
Prompt text and segment metadata stay within about 32 MiB; the least recently
used conversations are dropped first. Excerpts
extend at most 120 characters before and 180 after the first difference. When
both versions of a modified segment are JSON objects with a top-level `id` and
they still differ without it, as with Codex items that carry content-hash ids,
the excerpts compare the objects without their `id`, whether or not the id
changed. Images, documents, audio, and generated images, including
Codex data URLs, as well as signatures and encrypted reasoning, appear only as
hash markers. Turning `cacheMissDebug` off discards snapshots and stops new
reports; existing reports remain until cleared, a server restart, or a plugin
reload. Each report writes one info log line with the provider, session id,
account id, missed and expected tokens, cause kinds, and divergence path, but
no prompt text or account labels.

A nested server in `proxy` mode does not analyze the traffic it forwards.
`bb pool cache-miss list` there says so, and its `--json` output sets
`forwardsToParent` to `true`. Enable `cacheMissDebug` on the parent pool that
owns the accounts.
