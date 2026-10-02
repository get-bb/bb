Find any prompt you have sent before, star the ones you reuse, and drop them back into the composer without retyping.

Disabled by default. Enable **Prompt Library** in Settings → Plugins or run
`bb plugin enable bb--prompt-library`.

## What you get

- A **Prompts…** entry in the composer plus menu, also bound to **Ctrl+R** (rebind it as "Search prompts" in keyboard settings).
- A search box that fuzzy-matches your previous prompts as you type.
- **Starred** prompts pinned above **Recent** ones, most recently used first.
- Scope toggles: **Thread**, **Project**, and **All** in a thread; **Project** and **All** in the new-thread composer. The last choice is remembered on this device.
- `bb prompts search|list|star|unstar` for the same data from the terminal.

## How it works

1. Press **Ctrl+R** in the composer, or open the plus menu and choose **Prompts…**.
2. Type to search. Use the arrow keys to move, **Tab** to switch scope, and **Enter** to insert.
3. Press **Cmd+S** (**Ctrl+S** elsewhere) or click the star to star or unstar the highlighted prompt. With text in the composer, **Star current draft** stars it.

Inserting into an empty composer restores the whole prompt, including mentions and attachments. Otherwise the prompt's text and mentions go where the cursor was. Starred prompts keep text and mentions; attachments are dropped.

Previous prompts come from bb's prompt history: messages you sent yourself, not ones sent by agents.
