# Core command index

This index lists every command path that the core CLI registers, including aliases: `thread get|view|status` run `thread show`, `thread message|send` run `thread tell`, `thread messages|timeline` run `thread log`, `thread create|new` run `thread spawn`, `terminal read` runs `terminal output`, `plugin uninstall` runs `plugin remove`, and `environment get` runs `environment show`. At the top level `bb host`, `bb hosts`, and `bb machines` run `bb machine`, `bb env` runs `bb environment`, and the plurals `threads`, `projects`, `terminals`, `providers`, `plugins`, and `skills` run their singular command, unless a plugin registers that name. `bb guide commands <group>` prints a group's commands with every option on one page. Read the task-specific reference before you use a command. Check live help for flags and defaults.

## status

- `bb status`

## settings

- `bb settings`
- `bb settings show`
- `bb settings ai-services`
- `bb settings general`
- `bb settings completed-turns`
- `bb settings experiment`
- `bb settings keyboard`
- `bb settings keyboard hints`
- `bb settings keyboard list`
- `bb settings keyboard set`
- `bb settings keyboard reset`
- `bb settings ui`
- `bb settings ui list`
- `bb settings ui get`
- `bb settings ui set`
- `bb settings ui reset`
- `bb settings usage`
- `bb settings version`
- `bb settings reload`

## project

- `bb project`
- `bb project source`
- `bb project source add`
- `bb project source update`
- `bb project source delete`
- `bb project attachment`
- `bb project attachment upload`
- `bb project attachment download`
- `bb project list`
- `bb project history`
- `bb project reorder`
- `bb project branches`
- `bb project paths`
- `bb project commands`
- `bb project files`
- `bb project content`
- `bb project create`
- `bb project show`
- `bb project update`
- `bb project delete`

`bb project show <id>` accepts `proj_personal` to inspect Personal.

## provider

- `bb provider`
- `bb provider list`
- `bb provider models`

## manager

- `bb manager`
- `bb manager hire`
- `bb manager list`
- `bb manager status`
- `bb manager delete`

## machine

- `bb machine`
- `bb machine providers`
- `bb machine enroll`
- `bb machine env`
- `bb machine env list`
- `bb machine env set`
- `bb machine env unset`
- `bb machine create`
- `bb machine list`
- `bb machine show`
- `bb machine rename`
- `bb machine remove`
- `bb machine suspend`
- `bb machine resume`
- `bb machine reconcile`
- `bb machine retry-cleanup`
- `bb machine retry-update`
- `bb machine provider-cli`
- `bb machine provider-cli status`
- `bb machine provider-cli install`

`bb thread spawn --new-machine <provider-id>` creates a machine for a new
environment and requires `--environment-provider <id>`. For a composed option,
use `--environment-provider modal-sandbox` alone. `--machine-inputs <json>`
configures the machine with optional configured `preset` and `image` names;
`--environment-inputs <json>` configures the workspace. Neither carries secrets.

## server

- `bb server`
- `bb server move`
- `bb server move status`
- `bb server move cancel`
- `bb server export`
- `bb server import`
- `bb server unlock`
- `bb server allow-connect`
- `bb server delete-old-copy`
- `bb server install-machine-service`

`move`, `move status`, `move cancel`, and `export` call the running server.
Server moves are experimental; agents run `move` (without `--check`),
`move cancel`, and `unlock` only after the user explicitly confirms.
`import`, `unlock`, `allow-connect`, and `delete-old-copy` act on a local data
directory (`--data-dir`, else `BB_DATA_DIR`, else `~/.bb`) and never call a
server. `install-machine-service` acts on the same local data directory after a
move and downloads the new server's bb-app package for its service.

## updates

- `bb updates`
- `bb updates status`
- `bb updates apply`

## terminal

- `bb terminal`
- `bb terminal list`
- `bb terminal create`
- `bb terminal start`
- `bb terminal show`
- `bb terminal attach`
- `bb terminal send`
- `bb terminal resize`
- `bb terminal output`
- `bb terminal read`
- `bb terminal wait`
- `bb terminal rename`
- `bb terminal restart`
- `bb terminal close`
- `bb terminal stop`

## thread

- `bb thread`
- `bb thread wait`
- `bb thread spawn`
- `bb thread create`
- `bb thread new`
- `bb thread fork`
- `bb thread list`
- `bb thread show`
- `bb thread get`
- `bb thread view`
- `bb thread status`
- `bb thread log`
- `bb thread messages`
- `bb thread timeline`
- `bb thread output`
- `bb thread open`
- `bb thread pane`
- `bb thread section`
- `bb thread section list`
- `bb thread section create`
- `bb thread section rename`
- `bb thread section delete`
- `bb thread search`
- `bb thread history`
- `bb thread read`
- `bb thread unread`
- `bb thread reorder-pinned`
- `bb thread count`
- `bb thread queue`
- `bb thread queue list`
- `bb thread queue create`
- `bb thread queue update`
- `bb thread queue send`
- `bb thread queue delete`
- `bb thread queue reorder`
- `bb thread queue group`
- `bb thread tabs`
- `bb thread tabs show`
- `bb thread tabs set`
- `bb thread update`
- `bb thread archive`
- `bb thread unarchive`
- `bb thread pin`
- `bb thread unpin`
- `bb thread delete`
- `bb thread edit-message`
- `bb thread tell`
- `bb thread message`
- `bb thread send`
- `bb thread retry`
- `bb thread stop`
- `bb thread compact`
- `bb thread context`
- `bb thread clear`
- `bb thread cancel-plan`
- `bb thread clear-goal`
- `bb thread interactions`
- `bb thread interactions list`
- `bb thread interactions show`
- `bb thread interactions approve`
- `bb thread interactions grant`
- `bb thread interactions answer`
- `bb thread interactions respond`
- `bb thread interactions deny`

## environment

- `bb environment`
- `bb environment providers`
- `bb environment list`
- `bb environment delete`
- `bb environment show`
- `bb environment get`
- `bb environment status`
- `bb environment branches`
- `bb environment paths`
- `bb environment diff`
- `bb environment diff-files`
- `bb environment diff-file`
- `bb environment diff-patch`
- `bb environment update`
- `bb environment commit`
- `bb environment archive-threads`
- `bb environment pull-request`
- `bb environment pull-request show`
- `bb environment pull-request ready`
- `bb environment pull-request draft`
- `bb environment pull-request merge`

## file

- `bb file`
- `bb file read`
- `bb file write`
- `bb file list`
- `bb file paths`
- `bb file mkdir`
- `bb file move`
- `bb file remove`

## theme

- `bb theme`
- `bb theme list`
- `bb theme set`
- `bb theme dir`
- `bb theme favicon`
- `bb theme favicon set`
- `bb theme favicon reset`
- `bb theme show`
- `bb theme reset`

## plugin

- `bb plugin`
- `bb plugin search`
- `bb plugin list`
- `bb plugin source`
- `bb plugin install`
- `bb plugin outdated`
- `bb plugin update`
- `bb plugin new`
- `bb plugin types`
- `bb plugin migrate`
- `bb plugin build`
- `bb plugin dev`
- `bb plugin reload`
- `bb plugin rpc`
- `bb plugin rpc list`
- `bb plugin rpc inspect`
- `bb plugin rpc call`
- `bb plugin enable`
- `bb plugin disable`
- `bb plugin config`
- `bb plugin token`
- `bb plugin run`
- `bb plugin logs`
- `bb plugin remove`
- `bb plugin uninstall`

## marketplace

- `bb marketplace`
- `bb marketplace add`
- `bb marketplace list`
- `bb marketplace refresh`
- `bb marketplace remove`

## skill

- `bb skill`
- `bb skill list`
- `bb skill show`
- `bb skill files`
- `bb skill update`
- `bb skill delete`
- `bb skill search`
- `bb skill registry`
- `bb skill registry detail`
- `bb skill install`
- `bb skill cli-skills-status`
- `bb skill install-cli-skills`

## guide

- `bb guide`

## diagnostics

- `bb diagnostics`
- `bb diagnostics cli-errors`

`bb diagnostics cli-errors` tallies the failed `bb` invocations recorded in `<data dir>/logs/cli-errors.jsonl` on this machine. It records the command path, the error code, and the unknown command or flag, never argument values. `BB_CLI_ERROR_LOG=0` turns recording off.

## voice

- `bb voice`
- `bb voice transcribe`

## browser

- `bb browser`
- `bb browser instances`
- `bb browser tabs`
- `bb browser create`
- `bb browser acquire`
- `bb browser connection`
- `bb browser release`
- `bb browser reveal`
- `bb browser close`
- `bb browser capture`
- `bb browser watch`
- `bb browser import-sources`
- `bb browser import-cookies`

Machine lists and name/ID selectors include machines still being created. Machine creation is durable: `create --no-wait` returns the creating host ID. `machine show <host-id>` reads progress and `machine remove <host-id>` cancels it. SIGINT only stops following.

Machine environment: `bb machine env list`, `bb machine env set NAME`
(value from stdin), and `bb machine env unset NAME`; all accept `--project <id>` for project overrides and `--json`. Omit `--project` for global settings.

Standalone `bb machine create` machines remain until explicitly removed.

To enroll an existing machine, run `bb machine create --provider manual`, then
run its printed enrollment command on the target. The CLI waits until the daemon
connects. With `--no-wait`, it returns the creating host ID immediately.
