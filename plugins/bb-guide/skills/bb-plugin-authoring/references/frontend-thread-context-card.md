# Thread context card

A thread pane shows its thread context one of two ways: `banner`, the context
row above the composer, or `card`, the thread context card at the pane's
upper-right, below the header. bb picks one per pane: `card` while the
`threadContextCard` experiment is on, for a thread opened as a page, except on
phones (a narrow touch screen); `banner` everywhere else, including threads
shown inside a panel.

`app.slots.experimental_threadContextCardRow({ id, group, order?, component })`
adds a row to the card's top block, and
`app.slots.experimental_threadContextCardSection({ id, title, group, order?, component })`
adds a section below the rows under its title and a divider: the card's
counterparts of the Info tab's `experimental_threadInfoRow` and
`experimental_threadInfoSection`. Rows sort by `group`, then `order` (unset
last), then registration order, bb's first on a tie, using the Info tab's
`experimental_THREAD_INFO_ROW_GROUPS`; sections sort the same way using
`experimental_THREAD_INFO_SECTION_GROUPS`. bb's parent row and Child threads
section, the Git plugin's changes row, and GitHub PR Status's pull request row
use these slots. Components receive `{ threadId, projectId, environment }` and
render `experimental_ThreadContextCardRow` rows, or null to show nothing; a
crash removes only that row or section.

bb owns the card, placement, and header button: each split pane has its own
card, and it stays put while messages scroll. In a wide pane the card sits
beside the transcript, and a medium pane moves the transcript aside to fit it;
there the header button pins or unpins it (`threadContextCard.pinned`,
default on). A narrow pane or window opens it from the header button as a
popover.

```tsx
app.slots.experimental_threadContextCardRow({ id: "deploy", group: ROW_GROUPS.environment, order: 40, component: DeployRow });
function DeployRow({ threadId }: ExperimentalThreadContextCardProps) {
  const deploy = useDeploy(threadId);
  if (!deploy) return null;
  return <ThreadContextCardRow icon="Rocket" label={deploy.label} trailing={deploy.status} onClick={deploy.open} />;
}
```

Context segments keep showing in both kinds. A plugin whose segment shows the
same content as its card row hides the segment while the pane shows the card,
with `experimental_useThreadContextKind()`:

```tsx
app.slots.experimental_threadContextSegment({
  id: "deploy",
  title: "Deploy",
  group: "2_deploy",
  summary: DeploySummary,
  useVisible: () => experimental_useThreadContextKind() === "banner",
});
```
