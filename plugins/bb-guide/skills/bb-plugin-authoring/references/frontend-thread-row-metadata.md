# Thread row metadata

`app.slots.experimental_threadRowMetadata` adds a small item to the metadata
line under each thread row's title in bb's sidebar. The sidebar draws that line
only while the `threadRowMetadata` experiment is on and the user turns on
Organize → Rows → Metadata (both off by default), and only on rows where an
item shows something. Plugin-built lists draw the same
items with `experimental_ThreadRowMetadata` (see "bb's row metadata on your
row"). The GitHub PR Status plugin's pull request badge is one.

```tsx
type Deploys = Record<string, Deploy> | undefined;
app.slots.experimental_threadRowMetadata<Deploys>({
  id: "deploy",
  order: 10,
  useData: useDeploys,
  component: DeployBadge,
});
function useDeploys({ threads }: ExperimentalThreadRowMetadataDataInput) {
  const keys = threads.flatMap((thread) =>
    thread.environment?.id ? [thread.environment.id] : [],
  );
  return experimental_useRpcKeyedQuery({
    contract,
    method: "deploys",
    keys,
    enabled: keys.length > 0,
  }).data;
}
function DeployBadge({
  thread,
  data,
}: ExperimentalThreadRowMetadataProps<Deploys>) {
  const deploy = thread.environment?.id ? data?.[thread.environment.id] : undefined;
  return deploy ? <DeployGlyph deploy={deploy} /> : null;
}
```

`useData` is a React hook bb calls once for the whole app while any list draws
a metadata line, never per row. It receives every thread a list may show:
the active sidebar threads, including rows a windowed list has not rendered,
plus any other thread whose line is mounted. Load them in one batch there.
Components receive `{ thread, data }` and only draw; with `useData` they first
render once it has returned, so a row that renders already has its data and
keeps its height as it scrolls into view. Return null to show nothing. Read through `experimental_useRpcKeyedQuery` so every
row's read lands in one keyed request; a server that answers from what it has
and refreshes in the background lets rows draw without waiting. Keep the item to an icon and a few characters with a
tooltip; items share the line left to right, the line clips at the row's edge,
it is hidden while the row is renamed or customized, and a click on it opens
the thread. Items sort by `order` (unset last), then
registration order. A crash removes only that item on that row.

## bb's row metadata on your row

A plugin-built thread list renders every plugin's `experimental_threadRowMetadata`
(bb's pull request badge among them) by placing `experimental_ThreadRowMetadata`
with the row's `thread` on its own line under the title, in a flex parent as
wide as the line. It renders nothing when no plugin contributes an item. Clicks on an item reach
your row's own handlers; forward them to your row link if the row is not
itself the link. frontend-pull-requests.md shows a full row.
