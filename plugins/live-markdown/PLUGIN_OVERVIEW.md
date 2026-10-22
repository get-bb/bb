Format Markdown as you type in the prompt box, while bb sends exactly the text you typed.

Disabled by default. Enable **Live Markdown** in Settings → Plugins or run
`bb plugin enable bb--live-markdown`.

## What you get

- Headings, **bold**, _italic_, and `code` display formatted in the new-thread, follow-up, and queued-message prompt boxes. Editing a sent message stays plain text.
- Bullets display as dots as soon as you type `- `; numbered items keep the numbers you typed.
- The line holding the caret shows its `#`, `**`, `_` and `` ` ``, so you always edit the real text.

## How it works

The plugin only paints: it never rewrites the draft, so drafts, history, and sent messages contain exactly the Markdown you typed. Mention pills are never hidden or split; formatting that wraps a whole pill applies to the pill. Fenced code blocks stay plain.
