# Bench stream provider (benchmark harness)

`bb-plugin-bench-stream-provider` registers the provider `bench-stream`, a
deterministic agent the thread streaming render benchmark drives. It grows
realistic thread history instantly and streams Markdown at a controlled rate,
so render cost and latency can be measured without a model in the loop. It is
not a product plugin.

Like `examples/plugins/echo-provider`, it imports only `@get-bb/plugin-sdk`
(and its `/provider-bridge` subpaths), `zod`, and node built-ins, so it builds
and installs like any third-party provider plugin.

## Install into a bb instance

```bash
bb plugin install tests/bench-stream-provider --yes
```

Run it from the repository root, or pass an absolute path. To check that the
plugin builds without a server, `bb plugin build tests/bench-stream-provider`
writes `dist/server.js` and the self-contained `dist/host.js` bridge artifact.

Set `BENCH_STREAM_LOG_DIR` in the host daemon's environment before it starts
if you want emission logs (see below). The declaration forwards that variable
to the bridge process explicitly.

## Prompt directives

Only the first line of the prompt is parsed. It is a directive name followed by
`key=value` tokens separated by whitespace. Unknown keys, duplicate keys, and
out-of-range values settle the turn as failed with a `provider/error` titled
"Invalid bench directive" that names the problem.

### `bench_history seed=<int> tools=<0..6>`

Emits one completed turn as fast as possible, with no pacing. Everything is
derived from `seed`, so the same seed always produces the same items:

- a reasoning item streamed as 3 to 6 deltas, 400 to 900 characters in total;
- `tools` tool activity items. With three or more, the set always includes one
  command execution and one file change, and generic tool calls fill the rest.
  A command execution streams 20 to 120 lines of output. A file change carries
  a unified diff with 2 to 4 hunks, as the Codex bridge sends it;
- generic tool calls use the item shapes the Claude Code bridge classifies its
  tools into, so they project like rows from a real thread:

  | Tool            | Item                                                | Result on `item.close`     |
  | :-------------- | :-------------------------------------------------- | :------------------------- |
  | `Read` (2 in 8) | `fileRead` with the absolute path                   | none                       |
  | `Grep`          | `search`, mode `content`                            | none                       |
  | `Glob`          | `search`, mode `path`                               | none                       |
  | `Edit`          | `fileChange` with `oldText` and `newText`           | 1 to 4 KB `cat -n` snippet |
  | `WebSearch`     | `webSearch` with one query                          | 1 to 4 KB result list      |
  | MCP tool        | `tool` with `server` `linear` or `github`, and args | 1 to 4 KB JSON             |
  | `TaskUpdate`    | `tool` with a suppressed presentation               | 1 to 4 KB task list        |

  Each generic call picks one of these, `Read` twice as often as the others.
  Like Claude Code, `fileRead` and `search` items carry no result, and
  `TaskUpdate` never renders a row;

- a final assistant message assembled from contiguous `##` sections of one of
  the realistic fixtures (2,000 to 16,000 characters), streamed as 8 to 40
  deltas across 1 to 4 `thread/delta` notifications;
- `turn.boundary completed`.

The timeline projects these as a reasoning operation, `file-read`, `search`,
`web-search`, `tool`, `command` and `file-change` work rows, and the assistant
conversation row.

### `bench_stream doc=<name> chunk=<chars> interval=<ms> [repeat=<int>] [prelude=<0|1>]`

Streams a fixture at a fixed rate:

1. When `prelude=1` (the default), a reasoning item (three deltas, closed) and
   one completed MCP tool call (`linear` `get_issue`, a `tool` item with a
   short JSON result) are emitted immediately.
2. `item.open` for the agent message.
3. One `thread/delta` notification per tick, each holding exactly one
   `item.textDelta` of `chunk` characters (the last may be shorter). Ticks are
   a `setTimeout` chain, `interval` ms apart, starting `interval` ms after the
   message opens.
4. After the last tick, one notification with `item.close` carrying the full
   text and `turn.boundary completed`.

The streamed document is `fixture(doc)` repeated `repeat` times (default 1)
joined with `"\n\n"`, which is `streamDocumentText(doc, repeat)` from the
fixtures module.

`thread/stop` with `intent: "interrupt"` cancels the timer and settles the turn
before the stop is answered: `item.close` with status `interrupted` and the text
emitted so far, then `turn.boundary interrupted`. `thread/resume` and a new
`turn/start` on a thread that is still streaming settle the running turn the
same way first. A release stop, a discard, or closing the bridge's stdin
cancels the timer without emitting anything.

`turn/steer` during a stream emits `input.accepted` into the running turn right
away and queues the steer text. The stream itself does not change. When the
document finishes, the final notification carries the message `item.close`,
then one `Response to: <steer>` message per queued steer, then
`turn.boundary completed`. An interrupted stream drops its queued steers. A
steer with no stream running is refused with `NO_ACTIVE_TURN` and a
`staleTurn` recovery hint.

### `bench_noop`

Settles the turn without opening it or emitting items: `input.accepted`, then
`turn.boundary completed` with `claimIfIdle`. The conformance suite uses it as
the zero-work prompt. Any token after `bench_noop` is an invalid directive.

### Anything else

Answers `Response to: <prompt>` as one completed message.

## Emission log

When `BENCH_STREAM_LOG_DIR` is set, every `bench_stream` turn appends JSON lines
to `<dir>/<threadId>.jsonl`, where `threadId` is the bb thread id the bridge
receives on `thread/start` and `turn/start`. The directory is created if
missing. Each line is written synchronously with `appendFileSync`, one line per
event:

```jsonl
{"event":"start","t":1767323045000,"doc":"long-response","docChars":16460,"chunk":24,"interval":30}
{"event":"delta","t":1767323045030,"chars":24}
{"event":"delta","t":1767323045060,"chars":48}
{"event":"complete","t":1767323052600}
```

- `start` is written once, after the agent message opens. `docChars` is the
  streamed document's length in UTF-16 code units, and `chunk` and `interval`
  echo the directive.
- `delta` is written after each tick's notification. `t` is the epoch ms taken
  right before the notification was written, and `chars` is the cumulative
  number of characters emitted.
- `complete` is written after `item.close` and `turn.boundary` are sent.

An interrupted stream has no `complete` line. If writing fails, the bridge
reports it once on stderr, stops logging for that stream, and keeps streaming.

## Fixtures

`src/fixtures/index.ts` (exported as `bb-plugin-bench-stream-provider/fixtures`)
exposes `FIXTURE_NAMES`, `getFixture(name)`, and
`streamDocumentText(name, repeat)`. Each fixture is an embedded string module,
so the host artifact needs no filesystem reads.

| Name               | Content                                                                                                               |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `long-response`    | The benchmark's 16.5 KB streaming response, byte-identical (pinned by a SHA-256 test)                                 |
| `incident-writeup` | Incident writeup with impact, timeline, action item, and appendix tables                                              |
| `refactor-plan`    | Refactor plan with nested numbered lists and `tsx`, `json`, `sql`, `diff`, and `bash` code                            |
| `api-design`       | API design doc with a 25-row parameter table, links, and `path:line` references                                       |
| `data-analysis`    | Data analysis answer with inline `$...$` and display `$$...$$` math                                                   |
| `pathological`     | A stray `` `echo $$` ``, a 120-item loose list, a 250-line fenced code block, a 60-row table, and ordinary paragraphs |

`bench_history` draws its messages from every fixture except `pathological`.

## Bridge capabilities

The handshake reports grammar `[3, 3]`, `sessionRestore`, `fork: "tip"`, and
`threadArchive`. It answers `initialize`, `model/list`, `provider/health`
(always ready, no CLI), `thread/start`, `thread/resume`, `thread/fork`,
`turn/start`, `turn/steer`, `thread/stop`, `thread/discard`, `thread/archive`,
and `thread/unarchive`. Resuming, forking, or starting a turn on an archived
session is rejected with a `sessionArchived` recovery hint until it is
unarchived. Rename, goal clear, and `skills/configure` are not advertised, so
the runtime never sends them and the bridge answers `METHOD_NOT_FOUND`.

## Tests

```bash
pnpm exec turbo run typecheck test --filter=bb-plugin-bench-stream-provider
```

- `provider-bridge.conformance.test.ts` pins every rule of the canonical
  Provider Bridge Protocol suite, including resume, fork, archived-session
  recovery, independent threads, interrupt settlement, zero-work turns, and
  declared presentation icons.
- `provider-bridge.stream.test.ts` covers pacing with fake timers, repeat,
  interrupt, release and resume cancellation, steering, directive validation,
  and the emission log.
- `provider-bridge.history.test.ts` runs `bench_history` through the SDK delta
  assembler, checks the Claude Code item shapes, determinism per seed, and the
  limits across 840 seed and tool combinations.
- `fixtures.test.ts` pins every fixture's SHA-256 and rejects unknown names.
