Turn bb into a chat app. Your conversations sit in a list on the left and the chat fills the rest of the window. Agents still run where bb would run them.

## What you get

- A **conversation list** with your chats grouped into Today, Yesterday, Previous 7 days and Older, plus a search box and a **New chat** button.
- A **New chat** screen with just a prompt box and a model picker.
- A **chat** page with the conversation and its composer.
- **Settings** at the bottom of the list.

## What it hides

bb's sidebar, the project, environment and permission pickers, open-in-editor, the panel toggles, and the diff, terminal and file panels.

Hidden pickers keep bb's defaults: new chats use your last project and its default environment, and sends keep the thread's permission mode.

## How it works

The plugin draws bb's New thread screen and thread pages at bb's own URLs. Links, notification taps, quick-palette search (Cmd/Ctrl+K) and `bb thread open` all open the chat page. Settings, Plugins and Skills still use bb's own pages.

Chats are ordinary bb threads, so they show up in bb's workspace too. Disable the plugin to get bb's workspace back: `bb plugin disable bb--chat`.

The plugin adds no agent tools or CLI commands.
