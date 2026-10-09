# Interactive Answers

Explore charts, calculations, illustrated guides, and previews directly in
agent answers. Agents compose native controls or a custom HTML interface;
interacting updates the answer immediately without another model call.

Interactive Answers ships with bb but is not installed by default. Install it
from Plugins or with `bb plugin install interactive-answers`.

## Use

Ask for a calculator, scenario comparison, or interactive explanation. The
plugin gives agents an `interactive_answer` tool, a document guide, examples,
and the `interactive-answers` skill. Native documents can include number
fields, sliders, choices, live metrics, line and bar charts, tables, text,
expandable explanations, and interactive vector diagrams. Every chart also has
a data table.

```bash
bb interactive-answers guide
bb interactive-answers example bill | bb interactive-answers publish --document-stdin
bb interactive-answers example stepper | bb interactive-answers publish --answer-stdin
```

Emit the returned `::interactive-answer{id="…"}` directive on its own line in
an assistant message.

Inputs are saved with each answer on the bb server, so they follow you across
devices and every open copy updates live. Inputs are context the agent can
read, never approvals. Published answers are immutable; a revised answer gets
a new ID. Answers, their state, and their event logs are stored in the plugin
database, scoped to their thread, and removed when that thread is deleted.

## Agents can drive answers

```sh
bb interactive-answers state <id>
bb interactive-answers watch <id> --since 0 --wait 20
bb interactive-answers actions <id>
bb interactive-answers do <id> set --args '{"people": 6}'
```

Native documents expose `set` and `reset`. HTML answers expose their own
actions with `window.answer.expose()`. `window.answer.send()` attaches data to
the user's next message as a pill. Commands run in the copy used most
recently, and the card shows "Agent · <action>" each time the agent acts.

## HTML answers

HTML answers are served from the plugin's `/frame` route with
`Content-Security-Policy: sandbox allow-scripts` and rendered in an
`<iframe sandbox="allow-scripts">`, so scripts run in an opaque origin with no
access to bb, its cookies, or the conversation, like inline-vis previews. As
with inline-vis, scripts can load remote content and use the network.

The frame talks to bb only through `postMessage`, and bb accepts messages only
from that frame's window:

- Web links and `window.answer.send()` take effect only while the frame has
  focus and a fresh user activation, at most once per second, so an answer
  cannot open tabs or insert composer pills while you type elsewhere. Links
  open through bb's URL handling and only for `http` and `https`.
- Events and action lists are rate limited per frame. State, events, command
  results, and shared data are size limited on the server.
- bb hands the frame the Inter font it already loaded, so answers make no
  third-party font request.
- Height is clamped to 4,000 px, frames load lazily, and data shared with the
  agent is framed as untrusted.
