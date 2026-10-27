# Thread row metadata

`app.slots.experimental_threadRowMetadata` adds a small item to the metadata
line under each thread row's title in bb's sidebar. The sidebar draws that line
only while the `threadRowMetadata` experiment is on and the user turns on
Organize → Rows → Metadata (both off by default), and only on rows where an
item shows something. Plugin-built lists draw the same
items with `experimental_ThreadRowMetadata` (see "bb's row metadata on your
row"). The GitHub PR Status plugin's pull request badge is one.

```tsx
app.slots.experimental_threadRowMetadata({
  id: "deploy",
  order: 10,
  component: DeployBadge,
});
function DeployBadge({ thread }: ExperimentalThreadRowMetadataProps) {
  const key = thread.environment?.id;
  const { data } = experimental_useRpcKeyedQuery({
    contract,
    method: "deploys",
    keys: key ? [key] : [],
    input: { maxAgeMs: 60_000 },
    enabled: key !== undefined,
  });
  const deploy = key ? data?.[key] : undefined;
  return deploy ? <DeployGlyph deploy={deploy} /> : null;
}
```

Components receive `{ thread }`. While any list draws a metadata line, bb also
mounts each component, hidden, for every active sidebar thread, so data is
loaded before a row renders and rows keep their height as they scroll into
view; render the same way either way. Return null to show nothing. Read through `experimental_useRpcKeyedQuery` so every
row's read lands in one keyed request; a read that accepts saved data (such as
`maxAgeMs`) draws without waiting. Keep the item to an icon and a few characters with a
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

`input` sends the method's other fields with every batched read of the hook's
keys; hooks with different `input` keep separate caches. A row read that
accepts saved data (as the GitHub PR Status read's `maxAgeMs` does) draws
without waiting and refreshes in the background.
