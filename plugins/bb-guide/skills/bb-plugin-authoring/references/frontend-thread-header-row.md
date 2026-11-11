# Rows under the thread header

`app.slots.experimental_threadHeaderRow({ id, order?, component })` adds a
full-width row directly under the header of every thread pane, split panes
included, above the conversation. Rows stack by `order` ascending (unset last,
ties in registration order).

```tsx
app.slots.experimental_threadHeaderRow({
  id: "sibling-tabs",
  order: 0,
  component: SiblingTabs,
});
function SiblingTabs({
  threadId,
  environment,
}: ExperimentalThreadHeaderRowProps) {
  const { threads } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  if (environment === null) return null;
  const siblings = threads.filter(
    (thread) => thread.environment?.id === environment.id,
  );
  if (siblings.length < 2) return null;
  return (
    <TabStrip
      threads={siblings}
      activeId={threadId}
      onSelect={(id) => navigate.toThread(id)}
    />
  );
}
```

The component receives `{ threadId, projectId, environment }` and mounts once
per visible thread; `environment` is `{ id }` taken from the thread, null when
it has none. Return null to take no space. Plugin hooks work as in any slot:
`experimental_useAppPanel()` and `experimental_usePanelTabs()` act on that
thread's side panel. A crash removes only that row for that thread.

## Replacing the thread title

`app.slots.experimental_threadHeaderTitle({ id, component })` replaces the
thread title text in the header of every thread pane, split panes included.
The component receives the same `{ threadId, projectId, environment }` as a
header row (`ExperimentalThreadHeaderTitleProps`). Use it when a header row
already shows the thread title, for example a breadcrumb instead:

```tsx
app.slots.experimental_threadHeaderTitle({
  id: "breadcrumb",
  component: Breadcrumb,
});
function Breadcrumb({
  projectId,
  environment,
}: ExperimentalThreadHeaderTitleProps) {
  const navigate = useBbNavigate();
  const names = useWorkspaceNames(projectId, environment);
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <button type="button" onClick={() => navigate.toProject(projectId)}>
        {names.project}
      </button>
      {environment ? <span>› {names.workspace}</span> : null}
    </span>
  );
}
```

`useWorkspaceNames` stands for your own lookup through the SDK.

bb keeps everything else in the header: the Thread actions menu right after
the title, header actions, pane controls, the right-panel toggle and the
window drag region. While the user renames the thread, bb shows its rename
field in place of your title. Double-click does not start a rename on a
plugin title, and in a split layout dragging the pane starts only from parts
of the title that are not links, buttons or inputs. The window title stays
the thread title. One title wins: the first by plugin id, then registration
order. A crash shows bb's title for that thread.

For a plugin page that should look like a thread page, give the navPanel an
`experimental_headerTitle` with the same breadcrumb and set
`experimental_hideFromNavigation: true` (see frontend-core-slots.md).
