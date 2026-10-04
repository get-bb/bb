Agents can message the agent in another thread, and each agent decides whether its answer goes to that agent, to you, or to both.

## What you get

- A `bb_thread_message` tool for every agent. The message shows as "Message to" the recipient in the sending thread and "Message from" the sender in the receiving thread.
- Agents answer another agent with the tool and answer you with a normal response.

## How it works

The message is delivered like `bb thread tell`: it steers the recipient's current turn, or starts a new one when the recipient is idle. Agents are told to message only threads that messaged them or that you asked them to contact. Disabling the plugin removes the tool; messages already sent stay readable in both threads.
