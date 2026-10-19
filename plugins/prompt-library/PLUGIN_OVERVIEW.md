Find any prompt you have sent before, star the ones you reuse, and drop them back into the composer without retyping.

Disabled by default. Enable **Prompt Library** in Settings → Plugins or run
`bb plugin enable bb--prompt-library`.

## What you get

- A **Prompts…** entry in the composer plus menu, also bound to **Ctrl+R** (rebind it as "Search prompts" in keyboard settings).
- Optional titles for saved prompts. Use **Add title** in the preview footer; existing titles are editable above the preview. Titles help you find prompts and never change the inserted text.
- A search box that finds previous prompts by words, word starts, abbreviations, or words with a typo as you type.
- **Starred** prompts pinned above **Recent** ones, most recently used first. Searching shows one ranked list: exact title matches first, then prompts that start with your query, then the closest word matches, favoring prompts that started threads in the new-thread composer, follow-ups in a thread, and recent prompts.
- Scope toggles: **Thread**, **Project**, and **All** in a thread; **Project** and **All** in the new-thread composer. The last choice is remembered on this device.
- `bb prompts search|list|star|title|unstar` for the same data from the terminal.

## How it works

1. Press **Ctrl+R** in the composer, or open the plus menu and choose **Prompts…**.
2. Type to search. Click a prompt or use the arrow keys to preview it, **Tab** to switch scope, and **Enter** or **Insert** to insert. Moving the mouse leaves the selection unchanged.
3. Press **Cmd+S** (**Ctrl+S** elsewhere) or click the star to star or unstar the highlighted prompt. With text in the composer, **Star current draft** stars it.

If a search fails or takes more than 5 seconds, click **Retry** to repeat it without closing the picker or retyping. Previously loaded prompts stay available while searching or after an error.

Inserting into an empty composer restores the whole prompt, including mentions and attachments. Otherwise the prompt's text and mentions go where the cursor was. Starred prompts keep text and mentions; attachments are dropped.

Previous prompts come from bb's prompt history: messages you sent yourself, not ones sent by agents.

Name a new prompt with `bb prompts star --title "Review this branch" "Review the work on this branch"`. Rename it with `bb prompts title <id> "New title"`, or remove its title with `bb prompts title <id> --clear`. Titles are limited to 120 characters. Starring an existing prompt keeps its title; rename it explicitly to change it.

The server starts loading history when the plugin starts. Opening the picker shows saved prompts and available history without waiting for older pages, even in a fresh browser. Results update while loading; incomplete searches say **Searching older prompts…**. If history fails, available prompts stay usable and **Retry** resumes loading. CLI searches wait for complete results by default; add `--partial` for an immediate snapshot with loading/error status.
