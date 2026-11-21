See the servers that an agent started for a thread, and open or stop them without a terminal. Agents often start a dev server and leave it running. This plugin shows each one with its ports, above the thread's composer.

## What you get

- A "Servers" item in the thread's context row with the server count and ports.
- For each server: its ports, its command, an Open button, and a Stop button.
- Stop ends the server's command and every process under it. It never stops the agent, its shell, or bb.
- The list updates when a turn ends and every 15 seconds while the thread is open.
- When you archive or delete a thread, its servers stop if the thread's machine is online. The `Stop servers when a thread is archived` setting turns this off.

## How it works

bb sets `BB_THREAD_ID` in the shells of each agent. The plugin runs on the machine of the thread's environment. It finds the processes that listen on a TCP port, carry the thread's id, and came from the agent's shell. A server that outlived its shell still counts. Open goes to `http://localhost:<port>`, so it shows only for servers on the machine that runs the bb server, when the app was opened on that machine.

## CLI

- `bb dev-servers list [thread-id] [--json]`: list the servers of a thread, or of every thread outside one.
- `bb dev-servers stop <pid> [--thread <thread-id>] [--json]`: stop a server.

## Requirements

Linux and macOS machines. On Windows the list is empty.
