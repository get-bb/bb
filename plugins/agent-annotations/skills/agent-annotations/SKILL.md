---
name: agent-annotations
description: Create or edit element annotations in desktop Browser tabs, or update saved annotation comments through the plugin RPC.
---

Enable Agent Annotations in Settings → Plugins. In a desktop Browser tab, activate Annotate elements, select an element, and add its comment to the prompt. Click a numbered pin to edit its comment, including when selection mode is off. Save or Ctrl+Enter (Command+Enter on macOS) updates the saved comment; Cancel or Escape discards the edit. Blank comments cannot be saved. Delete in the pin editor removes that pin and its reference from the current unsent prompt. Successful local message submission or queueing clears the page annotations; failed sends keep them. Pins also disappear when the page navigates or reloads. Saved records remain available to previously sent messages.

Prompt mentions use a stable annotation number and element description. Edits update the context resolved when the prompt is sent without inserting another mention. Messages already sent are unchanged.

The plugin exposes `update` through its typed `agentAnnotationsRpcContract` and the generic plugin RPC SDK/CLI. Supply the saved annotation ID and a nonblank comment of up to 4000 characters in a JSON file:

```json
{ "id": "annotation-id", "comment": "Make this button green" }
```

```sh
bb plugin rpc call agent-annotations update --input-file annotation-update.json --json
```

An unknown ID or invalid comment fails without creating a record. RPC updates change saved context; an already-open page pin keeps its local comment until it is edited again.
