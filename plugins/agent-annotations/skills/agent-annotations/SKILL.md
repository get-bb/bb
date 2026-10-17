---
name: agent-annotations
description: Create or edit element annotations in desktop Browser tabs, or update saved annotation comments through the plugin RPC.
---

Enable Agent Annotations in Settings → Plugins. In a desktop Browser tab, activate Annotate elements, select an element, write its comment, and choose Add to prompt or press Ctrl+Enter (Command+Enter on macOS). Focus stays on the page so you can keep annotating. Clicking another element, clicking a pin, or turning annotating off saves the open comment first; Cancel or Escape is the only way to discard it, and blank comments are never saved. When you stop annotating with Escape or the toolbar button, focus moves to the composer so you can review the prompt and send it.

Click a numbered pin to edit its comment, including when selection mode is off. Delete in the pin editor removes that pin and its reference from the current unsent prompt. Successful local message submission or queueing clears the page annotations; failed sends keep them. Pins also disappear when the page navigates or reloads. Saved records remain available to previously sent messages.

Each prompt mention is a pill showing the annotation number and the start of its comment. Editing a pin updates its pill and the context resolved when the prompt is sent, without inserting another mention. Messages already sent are unchanged.

The plugin exposes `update` through its typed `agentAnnotationsRpcContract` and the generic plugin RPC SDK/CLI. Supply the saved annotation ID and a nonblank comment of up to 4000 characters in a JSON file:

```json
{ "id": "annotation-id", "comment": "Make this button green" }
```

```sh
bb plugin rpc call agent-annotations update --input-file annotation-update.json --json
```

An unknown ID or invalid comment fails without creating a record. RPC updates change saved context; an already-open page pin and its prompt pill keep the previous comment text until the pin is edited again.
