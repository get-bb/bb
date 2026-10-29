# Thread details card

`app.slots.experimental_threadDetailsCardRow({ id, group, order?, component })`
adds a row to the thread details card at the upper-right of every thread pane,
below the header, and `app.slots.experimental_threadDetailsCardSection({ id, title, group, order?, component })`
adds a titled section below its rows: the card's counterparts of the Info tab's
row and section slots. The card shows only while the `threadDetailsCard`
experiment is on; then bb's parent row and Child threads section, the
Git plugin's changes, and GitHub PR Status's pull request live there instead of
beside the composer. Rows sort by `group`, then `order` (unset last), then
registration order, bb's first on a tie, using the Info tab's
`experimental_THREAD_INFO_ROW_GROUPS`; they share one block with no heading.
Sections sort the same way below the rows, each under its title and a divider.
bb owns the card, placement, and header button: each split pane has its own
card, and it stays put while messages scroll. In a wide pane the card sits
beside the transcript, and a medium pane moves the transcript aside to fit it;
there the header button pins or unpins it (`threadDetailsCard.pinned`,
default on). A narrow pane or window opens it from the header button as a popover.
Phones (a narrow touch screen) show no card; there the context segments above the composer get
`threadDetailsCard: false` and keep showing. Components receive `{ threadId, projectId, environment }`
and render `experimental_ThreadDetailsCardRow` rows, or null to show nothing; a
crash removes only that row or section.

```tsx
app.slots.experimental_threadDetailsCardRow({ id: "deploy", group: ROW_GROUPS.environment, order: 40, component: DeployRow });
function DeployRow({ threadId }: ExperimentalThreadDetailsCardProps) {
  const deploy = useDeploy(threadId);
  if (!deploy) return null;
  return <ThreadDetailsCardRow icon="Rocket" label={deploy.label} trailing={deploy.status} onClick={deploy.open} />;
}
```

A plugin that also keeps a context segment beside the composer can hide it
where the card shows it instead: `useVisible` returns false when its input's
`threadDetailsCard` is true. Segments that ignore it keep showing beside the
composer.
