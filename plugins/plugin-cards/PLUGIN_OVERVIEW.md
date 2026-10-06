When you ask an agent whether bb can do something, it can answer with a card for an existing plugin instead of a name to search for. Click the card to open that plugin's detail page beside the conversation.

## What you get

- The same card the plugin store shows when you browse: icon, name, description, author, and install count.
- An installed plugin shows a check; one you don't have shows a download icon, or a warning when it doesn't support your version of bb.
- Clicking anywhere on the card, including its install icon, opens the detail page.

## How it works

The agent calls the `show_plugin_card` tool with a plugin id from `bb plugin search <terms> --json`. The tool checks that the id is installed or listed in the plugin store, then returns a line the agent copies into its reply:

```text
::plugin-card{id="browser-automation"}
```

The card only opens the detail page. Installing and enabling still happen there, with the usual confirmation and trust warnings; the agent and the card never change your plugins themselves.

The BB guide plugin's `find-plugins` skill tells agents when to search the store and how to recommend plugins. Turn off Plugin cards in Settings → Plugins, or run `bb plugin disable bb--plugin-cards`, to remove the tool and cards.
