# Items on thread rows

`app.slots.experimental_threadRowItem` adds a small item to every thread row in
bb's sidebar, beside the title and before the status glyph. Plugin-built lists
draw the same items with `experimental_ThreadRowItems` (see "bb's row items on
your row"). The GitHub PR Status plugin's pull request badge is one.

```tsx
app.slots.experimental_threadRowItem({
  id: "deploy",
  order: 10,
  component: DeployBadge,
});
function DeployBadge({ thread, isLive }: ExperimentalThreadRowItemProps) {
  const key = thread.environment?.id;
  const { data } = experimental_useRpcKeyedQuery({
    contract,
    method: "deploys",
    keys: key ? [key] : [],
    input: { maxAgeMs: 60_000 },
    enabled: isLive && key !== undefined,
  });
  const deploy = key ? data?.[key] : undefined;
  return deploy ? <DeployGlyph deploy={deploy} /> : null;
}
```

Components receive `{ thread, isLive }` and mount once their row is live; an
item that has drawn something mounts with its row from then on, so cached
content draws in the row's first frame. Return null to show nothing. `isLive` changes only at a scroll pause: on-screen rows turn
live and rows that left stop, together, about 200 ms after scrolling stops,
while the page is visible. Hiding the page turns every row off at once. Gate reads, watches and polling on it
and render cached data either way: rows that appear together read together in
one keyed request, rows scrolled past read nothing, and cached items draw in
the row's first frame. Keep the item icon-sized with a tooltip; the row's items
share at most 80 px, are hidden while the row is renamed or customized, and a
click on them opens the thread. Items sort by `order` (unset last), then
registration order. A crash removes only that item on that row.

## bb's row items on your row

A plugin-built thread list renders every plugin's `experimental_threadRowItem`
(bb's pull request badge among them) by placing `experimental_ThreadRowItems`
with the row's `thread` inside the row's title area, after the title. Its
parent element is what bb watches for visibility, so give it a box (not
`display: contents`). It renders nothing when no plugin contributes an item. Clicks on an item reach
your row's own handlers; forward them to your row link if the row is not
itself the link. frontend-pull-requests.md shows a full row.

`input` sends the method's other fields with every batched read of the hook's
keys; hooks with different `input` keep separate caches. A row read that
accepts saved data (as the GitHub PR Status read's `maxAgeMs` does) draws
without waiting and refreshes in the background.
