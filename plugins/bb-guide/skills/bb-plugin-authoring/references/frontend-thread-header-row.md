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
