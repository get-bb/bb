# Prime Agent Native Provider

bb integrates Prime Agent through `prime-agent --mode rpc`. It does not use
ACP. Prime Agent remains responsible for its model providers, persistent
session files, Python runtime, tools, packages, skills, and background daemon.

## Runtime Mapping

| bb surface                      | Prime Agent RPC or launch control                 | Status              |
| ------------------------------- | ------------------------------------------------- | ------------------- |
| Provider picker                 | Built-in `prime-agent` provider                   | Supported           |
| Model picker                    | `get_available_models`                            | Supported           |
| Reasoning picker                | `--thinking`, then session replacement            | Supported           |
| Start thread                    | New RPC process with a persistent `--session-dir` | Supported           |
| Resume thread                   | `--resume <session-file>`                         | Supported           |
| Send prompt                     | `prompt`                                          | Supported           |
| Steer active turn               | `steer`                                           | Supported           |
| Stop turn                       | `abort`, then close the RPC process               | Supported           |
| Compact context                 | `compact`                                         | Supported           |
| Rename thread                   | `set_session_name`                                | Supported           |
| Images                          | Native RPC image content                          | Supported           |
| bb and native skills            | Repeated `--skill` plus Prime Agent discovery     | Supported           |
| Session fork at a bb checkpoint | No matching checkpoint contract                   | Deferred            |
| bb dynamic tools                | No native RPC registration contract               | Rejected explicitly |
| Extension dialogs               | Cancelled to prevent a headless deadlock          | Deferred            |
| Schedules and heartbeats        | Native controls exist without a bb surface        | Deferred            |
| Agent messages and observation  | Native controls exist without a bb surface        | Deferred            |
| Refinement and HTML export      | Native controls exist without a bb surface        | Deferred            |

Each bb thread stores its Prime Agent session below the thread storage root.
The provider identity is the absolute Prime Agent session file path. All Prime
Agent RPC processes use a bb-specific daemon socket, avoiding collisions with
an independently running Prime Agent TUI.

bb launches Prime Agent with `--no-context-files` because the server owns the
assembled thread instructions. Prime Agent still discovers its native skills,
extensions, prompt templates, tools, and packages.
