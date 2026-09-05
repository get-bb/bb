# Navigation, search, and thread organization

Status: **source-documented; not live-verified in the initial smoke pass**.

## Setup and entry points

Two synthetic projects and several threads, including unread, pinned, archived, and child threads. Open the web app sidebar and quick palette.

Follow the main skill’s isolated launch, doctor, evidence, and cleanup rules.
CLI examples below omit the `pnpm --silent bb:dev` prefix; use that source CLI
against the same dev instance. Resolve IDs with list/show and inspect the named
command’s `--help` before mutation. Use fresh browser snapshots for controls.

## Source

- `apps/app/src/lib/app-command-metadata.ts`
- `apps/app/src/components/sidebar/ProjectList.tsx`
- `apps/cli/src/commands/thread/organization.ts`
- `apps/app/src/components/notifications/NotificationCenter.tsx`

## Feature recipes

| Feature | Drive | Observable success |
| --- | --- | --- |
| Home and projectless compose | Open / with and without a selected project; create a projectless draft, switch project, then return. | Draft and project selection follow their scopes; no accidental thread starts. |
| Search threads and message contents | Use Search threads in the quick palette; query a unique title and a different string found only in a message. Compare bb thread search `<query>`. | Matching thread/message opens the correct thread and preserves search scope. |
| Previous, next, and numbered jumps | Invoke the named keyboard actions over a filtered sidebar; repeat at both ends and with an input focused. | Navigation uses visible thread order and does not steal normal typing. |
| Pin, unpin, and pinned order | Pin two threads via Thread actions; reorder them; reload; unpin one. Compare thread pin/unpin/reorder-pinned and thread list. | Saved order and pin state agree across UI and CLI; unpin preserves the thread. |
| Read and unread | Mark a finished thread unread, open it, then mark read explicitly. Compare thread read/unread. | Unread indicators and notification eligibility follow the saved read state. |
| Sections | Create, rename, assign threads to, reorder, collapse, and delete a section. Use bb thread section --help for CLI forms. | Assignments and collapsed/order preferences persist; deleting a section does not delete its threads. |
| Grouping, sorting, display options | Use Sidebar display options for each offered grouping and sorting mode; change project order with bb project reorder; reload. | Every thread remains reachable exactly once in its applicable group; order persists. |
| Parents and children | Spawn a child of a synthetic parent; inspect thread list --parent-thread and the child links. Archive only the chosen family through the relevant action. | Parent relationships and visibility match the requested scope; unrelated threads survive. |
| Archived views and deletion | Open global and project archived routes; restore a synthetic thread; delete a disposable thread and cancel a second deletion. | Restore clears archival state; confirmed delete removes only the target; cancellation is inert. |
| Notification center | Open Show all notifications; follow one item and clear another. | The correct thread opens; read/clear behavior persists without pretending to prove OS delivery. |
| History and route recovery | Navigate app → Settings → Extensions → Back to app, then browser back/forward; reload a deep link and an unknown route. | The intended prior thread and route are restored; invalid links fail visibly. |

## Evidence and cleanup

Record a result for each row separately, including the chosen entry point,
initial state, action, resulting state, and relevant persisted value. Repeat
mutations through the available agent interface to establish parity. Preserve
failed attempts and prerequisites; source documentation is not a passing test.
Restore preferences and remove only the fixtures and sessions created by this
recipe. External writes require a disposable test target and task authorization.
